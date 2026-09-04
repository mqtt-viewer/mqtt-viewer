package mqtt

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"sync"
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

	if mm.GetConnectionState() == ConnectionStates.Connected {
		slog.WarnContext(mm.ctx, "attempted connection while already connected")
		return nil
	}

	if mm.GetConnectionState() == ConnectionStates.Connecting {
		slog.WarnContext(mm.ctx, "attempted connection while already connecting")
		return nil
	}

	if mm.GetConnectionState() == ConnectionStates.Reconnecting {
		slog.WarnContext(mm.ctx, "attempted connection while reconnecting")
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
	usingTls := connectionDetails.TlsConfig != nil
	if connectionDetails.MqttVersion == "3" {
		v3Client, err := mm.connectV3(connCtx, connectionDetails, subscriptions)
		if err != nil {
			mm.SetConnectionState(ConnectionStates.Disconnected, nil)
			return newMqttConnectError(friendlyConnectError(err, usingTls))
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
			return newMqttConnectError(friendlyConnectError(err, usingTls))
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
	urlString := buildBrokerURL(connectionDetails.Protocol, connectionDetails.Host, connectionDetails.Port, connectionDetails.WebsocketPath)
	broker, err := url.Parse(urlString)
	if err != nil {
		return nil, err
	}
	mm.pinger = newPingerV5(mm.ctx, mm.onNewLatencyMs)
	clientId := connectionDetails.ClientId
	// Buffered for the same reason as connectV3's subErrChan: a cancelled or
	// timed-out connect that has stopped reading this channel must not
	// strand the OnConnectionUp/OnConnectError callback goroutine on the
	// send below.
	connectErrChan := make(chan error, 1)
	var initialOnce sync.Once
	config := autopaho.ClientConfig{
		// Library loggers feed this connection's client-log store. Debug-level
		// sinks bail out before formatting when the per-connection debug toggle
		// is off, so assigning them unconditionally is safe and free.
		Debug:                         newPahoLogSink(mm.LogStore, LogLevelDebug),
		PahoDebug:                     newPahoLogSink(mm.LogStore, LogLevelDebug),
		PahoErrors:                    newPahoLogSink(mm.LogStore, LogLevelError),
		CleanStartOnInitialConnection: true,
		BrokerUrls:                    []*url.URL{broker},
		KeepAlive:                     30,
		ConnectRetryDelay:             3 * time.Second,
		ConnectTimeout:                CONNECTION_TIMEOUT,
		OnConnectionUp: func(cm *autopaho.ConnectionManager, c *paho.Connack) {
			// Both callbacks fire on every reconnect, not just the first connect. The
			// broker replays its retained set on subscribe, so dropping the index here
			// means it is rebuilt from broker truth rather than accumulating topics that
			// were tombstoned while we were disconnected.
			mm.ResetRetainedIndex()
			err := subscribeV5(ctx, mm.ctx, cm, subscriptions)
			if err != nil {
				slog.ErrorContext(mm.ctx, err.Error())
				initialOnce.Do(func() {
					connectErrChan <- err
				})
				return
			}
			mm.SetConnectionState(ConnectionStates.Connected, nil)
			initialOnce.Do(func() {
				connectErrChan <- nil
			})
		},
		OnConnectError: func(err error) {
			sent := false
			initialOnce.Do(func() {
				connectErrChan <- err
				sent = true
			})
			if !sent {
				slog.ErrorContext(mm.ctx, "connect error while reconnecting: "+err.Error())
			}
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
				if mm.GetConnectionState() == ConnectionStates.Connected {
					mm.SetConnectionState(ConnectionStates.Reconnecting, &err)
				}
			},
			OnServerDisconnect: func(d *paho.Disconnect) {

				errString := "server disconnected: " + d.Properties.ReasonString
				err := errors.New(errString)
				if mm.GetConnectionState() == ConnectionStates.Connected {
					mm.SetConnectionState(ConnectionStates.Reconnecting, &err)
				}
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
			mm.LogStore.Error("connect failed: " + err.Error())
			cm.Disconnect(ctx)
			return nil, err
		}
	case <-ctx.Done():
		cm.Disconnect(ctx)
		return nil, nil
	case <-time.After(CONNECTION_TIMEOUT):
		mm.LogStore.Error("timeout while connecting to broker")
		// Shut the connection manager down. Left running it keeps retrying in
		// the background forever, and can later report itself connected on a
		// connection the caller has already given up on.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), CONNECTION_TIMEOUT)
		defer cancel()
		cm.Disconnect(shutdownCtx)
		return nil, fmt.Errorf("timeout while connecting to broker")
	}

	return cm, nil
}

func (mm *MqttManager) connectV3(ctx context.Context, connectionDetails MqttConnectionDetails, subscriptions []SubscribeParams) (*mqttV3.Client, error) {
	// paho v3 loggers are process-global; install the broadcast dispatcher once
	// and register this connection so its verbose lines are captured while its
	// debug toggle is on (no-op when off — it's never registered). Register
	// before dialling so handshake/dial debug lines are captured too, and
	// unregister again on every failure path.
	installV3GlobalLoggers()
	debugRegistered := false
	if mm.LogStore.DebugEnabled() {
		v3Registry.register(mm.LogStore)
		debugRegistered = true
	}
	unregisterOnFail := func() {
		if debugRegistered {
			v3Registry.unregister(mm.LogStore.connId)
		}
	}

	urlString := buildBrokerURL(connectionDetails.Protocol, connectionDetails.Host, connectionDetails.Port, connectionDetails.WebsocketPath)
	opts := mqttV3.NewClientOptions()

	opts.AddBroker(urlString)

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
	opts.SetMaxReconnectInterval(30 * time.Second)
	opts.SetConnectRetry(false)
	// With this false, paho hands every incoming message to its own goroutine,
	// so messages reach the history and the timeline shuffled and even their
	// arrival timestamps get stamped out of order. True makes paho dispatch
	// sequentially from its reader goroutine, matching how the v5 client
	// already behaves. See receiveMessage for what that goroutine now carries
	// and why it is cheap enough.
	opts.SetOrderMatters(true)
	opts.SetConnectionLostHandler(func(c mqttV3.Client, err error) {
		if mm.GetConnectionState() == ConnectionStates.Connected {
			mm.SetConnectionState(ConnectionStates.Reconnecting, &err)
		}
	})

	// Buffered so a cancelled/timed-out connectV3 that has stopped reading
	// this channel doesn't strand the OnConnectHandler goroutine forever on
	// the send below.
	subErrChan := make(chan error, 1)
	var initialOnce sync.Once
	opts.SetOnConnectHandler(func(c mqttV3.Client) {
		// Both callbacks fire on every reconnect, not just the first connect. The
		// broker replays its retained set on subscribe, so dropping the index here
		// means it is rebuilt from broker truth rather than accumulating topics that
		// were tombstoned while we were disconnected.
		mm.ResetRetainedIndex()
		err := subscribeV3(mm.ctx, c, subscriptions)
		if err != nil {
			slog.Error(err.Error())
			initialOnce.Do(func() {
				subErrChan <- err
			})
			return
		}
		mm.SetConnectionState(ConnectionStates.Connected, nil)
		initialOnce.Do(func() {
			subErrChan <- nil
		})
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
	tokenErrChan := make(chan error, 1)
	go func() {
		token.Wait()
		tokenErrChan <- token.Error()
	}()
	timeoutChan := time.After(CONNECTION_TIMEOUT)
	for {
		select {
		// Connection cancelled
		case <-ctx.Done():
			client.Disconnect(500)
			unregisterOnFail()
			return nil, nil
		case <-timeoutChan:
			// Same as v5: auto-reconnect is on, so a client we walk away from
			// keeps trying to connect in the background.
			mm.LogStore.Error("timeout while connecting to broker")
			client.Disconnect(500)
			unregisterOnFail()
			return nil, fmt.Errorf("timeout while connecting to broker")
		case err := <-tokenErrChan:
			// A dial/TLS/auth failure completes the token with an error
			// before OnConnectHandler ever runs. Without watching this
			// channel those failures were invisible until the timeout
			// above fired, reporting a generic message instead of the
			// real cause. A nil error here means CONNACK succeeded, so
			// keep waiting for the subscribe result on subErrChan.
			if err != nil {
				mm.LogStore.Error("connect failed: " + err.Error())
				client.Disconnect(500)
				unregisterOnFail()
				return nil, err
			}
		case err := <-subErrChan:
			if err != nil {
				mm.LogStore.Error("connect failed: " + err.Error())
				client.Disconnect(500)
				unregisterOnFail()
				return nil, err
			}
			// Connected: stay registered so verbose v3 debug keeps flowing; Disconnect
			// and SetDebugLoggingEnabled(false) both unregister.
			return &client, nil
		}
	}
}

// clientIdPrefix is kept stable because brokers are commonly configured with
// ACLs or access rules that key on the client ID.
const clientIdPrefix = "mqtt-viewer-"

// maxGeneratedClientIdBytes is the length every MQTT 3.1.1 broker is required
// to accept ([MQTT-3.1.3-5]: servers MUST accept 1 to 23 UTF-8 bytes, and may
// accept more). Staying inside it means a strict or embedded broker cannot
// reject us with "identifier rejected".
const maxGeneratedClientIdBytes = 23

// getUniqueClientId builds the client ID for connections where the user has
// not set a custom one.
//
// The suffix is random rather than the Unix second it used to be. At second
// resolution any two connections opened in the same second got an identical
// ID, and a broker evicts the existing session when a new client presents an
// ID already in use, so the two connections sat kicking each other off. That
// hit anyone opening two connections to one broker at once, or running two
// copies of the app, and it was the cause of flaky broker tests.
//
// Five random bytes give a 22 byte ID, the same length as before and one
// under the limit. Sessions are always clean (v3 defaults to CleanSession,
// v5 sets CleanStartOnInitialConnection), and the generated ID is never
// persisted, so nothing depends on it staying the same between connects.
func getUniqueClientId() string {
	suffix := make([]byte, 5)
	// Never returns an error: since Go 1.24 crypto/rand.Read panics rather
	// than failing.
	_, _ = rand.Read(suffix)
	return clientIdPrefix + hex.EncodeToString(suffix)
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

func buildBrokerURL(protocol, host string, port int, wsPath string) string {
	base := fmt.Sprintf("%s://%s:%d", protocol, host, port)
	if wsPath == "" {
		return base
	}
	return base + "/" + strings.TrimLeft(wsPath, "/")
}
