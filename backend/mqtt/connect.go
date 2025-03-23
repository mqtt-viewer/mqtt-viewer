package mqtt

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
	mqttV3 "github.com/eclipse/paho.mqtt.golang"
)

var (
	CONNECTION_TIMEOUT = 10 * time.Second
	SUBSCRIBE_TIMEOUT  = 5 * time.Second
)

type MqttConnectionDetails struct {
	MqttVersion   string
	Protocol      string
	WebsocketPath string
	Host          string
	Port          int
	Username      string
	Password      []byte
	ClientId      string
	TlsConfig     *tls.Config
}

func (mm *MqttManager) Connect(connectionDetails MqttConnectionDetails, subscriptions []SubscribeParams) error {
	if mm.connectionCallbacks == nil {
		return newMqttConnectError(fmt.Errorf("please set connection callbacks before attempting connection"))
	}

	if mm.ConnectionState == ConnectionStates.Connected {
		slog.WarnContext(mm.ctx, "attempted connection while already connected")
		return nil
	}

	if mm.ConnectionState == ConnectionStates.Connecting {
		slog.WarnContext(mm.ctx, "attempted connection while already connecting")
		return nil
	}

	err := validateConnectionDetails(connectionDetails)
	if err != nil {
		return newMqttConnectError(err)
	}
	err = validateSubs(subscriptions)
	if err != nil {
		return newMqttConnectError(err)
	}

	if connectionDetails.ClientId == "" {
		connectionDetails.ClientId = getUniqueClientId()
	}
	mm.SetConnectionState(ConnectionStates.Connecting, nil)

	connCtx, cancelFunc := context.WithCancel(context.Background())
	mm.connection = &mqttActiveConnection{
		clientId:      connectionDetails.ClientId,
		mqttVersion:   connectionDetails.MqttVersion,
		cancelConnect: cancelFunc,
		connectionCtx: connCtx,
	}
	if connectionDetails.MqttVersion == "3" {
		v3Client, err := mm.connectV3(connCtx, connectionDetails, subscriptions)
		if err != nil {
			mm.SetConnectionState(ConnectionStates.Disconnected, nil)
			return newMqttConnectError(err)
		}
		if v3Client == nil {
			slog.InfoContext(mm.ctx, "v3 connect cancelled")
			mm.SetConnectionState(ConnectionStates.Disconnected, nil)
		}
		mm.connection.v3Connection = v3Client
		mm.connection.cancelConnect = nil

	} else {
		v5Client, err := mm.connectV5(connCtx, connectionDetails, subscriptions)
		if err != nil {
			mm.SetConnectionState(ConnectionStates.Disconnected, nil)
			return newMqttConnectError(err)
		}
		if v5Client == nil {
			slog.InfoContext(mm.ctx, "v5 connect cancelled")
			mm.SetConnectionState(ConnectionStates.Disconnected, nil)
			return nil
		}
		mm.connection.v5Connection = v5Client
		mm.connection.cancelConnect = nil
	}
	return nil
}

func (mm *MqttManager) connectV5(ctx context.Context, connectionDetails MqttConnectionDetails, subscriptions []SubscribeParams) (*autopaho.ConnectionManager, error) {
	urlString := fmt.Sprintf("%s://%s:%d%s", connectionDetails.Protocol, connectionDetails.Host, connectionDetails.Port, connectionDetails.WebsocketPath)
	broker, err := url.Parse(urlString)
	if err != nil {
		return nil, err
	}
	mm.pinger = newPingerV5(mm.ctx, mm.onNewLatencyMs)
	clientId := connectionDetails.ClientId
	connectErrChan := make(chan error)
	config := autopaho.ClientConfig{
		// Debug:                         NewMqttLogger(),
		// PahoDebug:                     NewMqttLogger(),
		CleanStartOnInitialConnection: true,
		BrokerUrls:                    []*url.URL{broker},
		KeepAlive:                     30,
		ConnectRetryDelay:             10 * time.Second,
		ConnectTimeout:                CONNECTION_TIMEOUT,
		OnConnectionUp: func(cm *autopaho.ConnectionManager, c *paho.Connack) {
			err := subscribeV5(ctx, mm.ctx, cm, subscriptions)
			if err != nil {
				slog.ErrorContext(mm.ctx, err.Error())
				connectErrChan <- err
				return
			}
			mm.SetConnectionState(ConnectionStates.Connected, nil)
			connectErrChan <- nil
		},
		OnConnectError: func(err error) {
			connectErrChan <- err
		},
		ClientConfig: paho.ClientConfig{
			PingHandler: mm.pinger,
			ClientID:    clientId,
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){
				func(pr paho.PublishReceived) (bool, error) {
					message := newMqttMessageFromV5(pr.Packet, time.Now())
					err := mm.receiveMessage(message)
					if err != nil {
						slog.ErrorContext(mm.ctx, err.Error())
					}
					return true, nil
				}},
			OnClientError: func(err error) {
				err = errors.New("client error: " + err.Error())
				mm.Disconnect(&err)
			},
			OnServerDisconnect: func(d *paho.Disconnect) {

				errString := "server disconnected: " + d.Properties.ReasonString
				err := errors.New(errString)
				mm.Disconnect(&err)
			},
		},
	}
	if connectionDetails.TlsConfig != nil {
		config.TlsCfg = connectionDetails.TlsConfig
	}
	if connectionDetails.Username != "" {
		config.ConnectUsername = connectionDetails.Username
	}
	if connectionDetails.Password != nil {
		config.ConnectPassword = connectionDetails.Password
	}

	cm, err := autopaho.NewConnection(ctx, config)
	if err != nil {
		return nil, err
	}
	select {
	case err := <-connectErrChan:
		if err != nil {
			cm.Disconnect(ctx)
			return nil, err
		}
	case <-ctx.Done():
		cm.Disconnect(ctx)
		return nil, nil
	case <-time.After(CONNECTION_TIMEOUT):
		return nil, fmt.Errorf("timeout while connecting to broker")
	}

	return cm, nil
}

func (mm *MqttManager) connectV3(ctx context.Context, connectionDetails MqttConnectionDetails, subscriptions []SubscribeParams) (*mqttV3.Client, error) {
	opts := mqttV3.NewClientOptions()

	opts.AddBroker(fmt.Sprintf("%s://%s:%d%s", connectionDetails.Protocol, connectionDetails.Host, connectionDetails.Port, connectionDetails.WebsocketPath))

	opts.SetClientID(connectionDetails.ClientId)
	if username := connectionDetails.Username; username != "" {
		opts.SetUsername(username)
	}
	if password := connectionDetails.Password; password != nil {
		opts.SetPassword(string(password))
	}
	if connectionDetails.TlsConfig != nil {
		opts.SetTLSConfig(connectionDetails.TlsConfig)
	}
	opts.SetAutoReconnect(true)
	opts.SetConnectRetry(false)
	opts.SetOrderMatters(false)
	opts.SetConnectionLostHandler(func(c mqttV3.Client, err error) {
		mm.Disconnect(&err)
	})

	subErrChan := make(chan error)
	opts.SetOnConnectHandler(func(c mqttV3.Client) {
		err := subscribeV3(mm.ctx, c, subscriptions)
		if err != nil {
			slog.Error(err.Error())
			subErrChan <- err
		}
		mm.SetConnectionState(ConnectionStates.Connected, nil)
		subErrChan <- nil
	})
	opts.SetConnectTimeout(CONNECTION_TIMEOUT)
	opts.SetKeepAlive(20 * time.Second)
	opts.SetPingTimeout(10 * time.Second)
	opts.SetDefaultPublishHandler(func(c mqttV3.Client, m mqttV3.Message) {
		message := newMqttMessageFromV3(&m, time.Now())
		err := mm.receiveMessage(message)
		if err != nil {
			slog.ErrorContext(mm.ctx, err.Error())
		}
	})

	client := mqttV3.NewClient(opts)
	token := client.Connect()
	go func() {
		token.Wait()
	}()
	select {
	// Connection cancelled
	case <-ctx.Done():
		client.Disconnect(500)
		return nil, nil
	case <-time.After(CONNECTION_TIMEOUT):
		return nil, fmt.Errorf("timeout while connecting to broker")
	case err := <-subErrChan:
		if err != nil {
			client.Disconnect(500)
			return nil, err
		}
	}
	if token.Error() != nil {
		return nil, token.Error()
	}
	return &client, nil
}

func getUniqueClientId() string {
	return fmt.Sprintf("mqtt-viewer-%d", time.Now().Unix())
}

func validateConnectionDetails(connectionDetails MqttConnectionDetails) error {
	if connectionDetails.Host == "" {
		return errors.New("host is required")
	}
	if connectionDetails.Port == 0 {
		return errors.New("port is required")
	}
	if connectionDetails.MqttVersion != "3" && connectionDetails.MqttVersion != "5" {
		return errors.New("mqtt version must be 3 or 5")
	}
	return nil
}

func validateSubs(subs []SubscribeParams) error {
	hasTopic := false
	for _, sub := range subs {
		if sub.Topic != "" {
			hasTopic = true
			break
		}
	}
	if !hasTopic {
		return errors.New("at least one topic is required")
	}
	return nil
}

func newMqttConnectError(err error) error {
	return fmt.Errorf("connect: %w", err)
}
