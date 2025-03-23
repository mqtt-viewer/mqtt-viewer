package app

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/matchers"
	"mqtt-viewer/backend/middlewares"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	"mqtt-viewer/backend/security"
	"time"
)

const MQTT_BUFFER_EMIT_INTERVAL = 300 * time.Millisecond

func (a *App) ConnectMqtt(connId uint) error {
	var err error
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return fmt.Errorf("connection not found (%d)", connId)
	}
	// Always reload the sub matcher / proto matcher, subscriptions may have changed
	appConnection.SubscriptionMatcher = matchers.NewSubscriptionMatcher(appConnection.Connection.Subscriptions)

	if appConnection.Connection.IsProtoEnabled != nil && *appConnection.Connection.IsProtoEnabled && appConnection.Connection.ProtoRegDir.Valid {
		if appConnection.LoadedProtoRegistry == nil {
			protoReg, err := protobuf.LoadProtoRegistry(appConnection.Connection.ProtoRegDir.String)
			if err != nil {
				return err
			}
			appConnection.LoadedProtoRegistry = protoReg
		}
		appConnection.ProtoMatcher = matchers.NewProtoMatcher(*appConnection.ctx, appConnection.SubscriptionMatcher, *appConnection.LoadedProtoRegistry.LoadedDescriptorsNameMap)
		appConnection.MqttManager.UseMiddleware(mqtt.MqttMiddlewares{
			BeforePublish: []mqtt.Middleware[mqtt.MqttPublishParams]{
				middlewares.NewProtoEncodeMiddleware(appConnection.ProtoMatcher).Middleware,
			},
			BeforeAddToHistory: []mqtt.Middleware[mqtt.MqttMessage]{
				middlewares.NewProtoDecodeMiddleware(appConnection.ProtoMatcher).Middleware,
			},
		})
	} else {
		appConnection.ProtoMatcher = nil
		appConnection.MqttManager.UseMiddleware(mqtt.MqttMiddlewares{})
	}

	connectionDetails, err := getConnectionDetailsFromConnectionModel(appConnection.Connection)
	if err != nil {
		slog.Error(err.Error())
		return err
	}

	subs := make([]mqtt.SubscribeParams, len(appConnection.Connection.Subscriptions))
	for i, sub := range appConnection.Connection.Subscriptions {
		subs[i] = mqtt.SubscribeParams{
			Topic: sub.Topic,
			QoS:   int(*sub.QoS),
		}
	}

	err = appConnection.MqttManager.Connect(*connectionDetails, subs)
	if err != nil {
		slog.Error(err.Error())
		return err
	}
	return nil
}

func (a *App) DisconnectMqtt(connId uint) error {
	appConnection := a.AppConnections[connId]
	appConnection.MqttManager.Disconnect(nil)
	return nil
}

func (a *App) GetMessageHistory(connId uint, topic string) ([]mqtt.MqttMessage, error) {
	appConnection := a.AppConnections[connId]
	messageHistory, err := appConnection.MqttManager.MessageHistory.GetTopicHistory(topic)
	if err != nil {
		return nil, err
	}
	return messageHistory, nil
}

func (a *App) ClearConnectionHistory(connId uint) error {
	appConnection := a.AppConnections[connId]
	appConnection.MqttManager.ClearConnectionHistory()
	a.EventRuntime.EventsEmit(appConnection.EventSet.MqttClearHistory, nil)
	return nil
}

type PublishParams struct {
	Topic      string            `json:"topic"`
	QoS        int               `json:"qos"`
	Payload    string            `json:"payload"`
	Retain     bool              `json:"retain"`
	Properties PublishProperties `json:"properties"`
}

type PublishProperties struct {
	ContentType            string            `json:"contentType,omitempty"`
	PayloadFormatIndicator bool              `json:"payloadFormatIndicator"`
	MessageExpiryInterval  int               `json:"messageExpiryInterval,omitempty"`
	TopicAlias             int               `json:"topicAlias,omitempty"`
	ResponseTopic          string            `json:"responseTopic,omitempty"`
	CorrelationData        string            `json:"correlationData,omitempty"`
	SubscriptionIdentifier int               `json:"subscriptionIdentifier,omitempty"`
	UserProperties         map[string]string `json:"userProperties,omitempty"`
}

func (a *App) PublishMqtt(connId uint, message PublishParams) error {
	appConnection, err := getConnectedConnection(a, connId)
	if err != nil {
		return err
	}

	properties, err := makePublishProperties(&message.Properties)
	if err != nil {
		return err
	}

	bytesPayload := []byte(message.Payload)
	mqttPublishParams := mqtt.MqttPublishParams{
		Topic:      message.Topic,
		QoS:        message.QoS,
		Payload:    bytesPayload,
		Retain:     message.Retain,
		Properties: properties,
	}
	err = appConnection.MqttManager.Publish(mqttPublishParams)
	if err != nil {
		return err
	}
	return nil
}

func (a *App) DeleteRetainedMessage(connId uint, topic string) error {
	publishParams := PublishParams{
		Topic:   topic,
		QoS:     0,
		Payload: "",
		Retain:  true,
	}
	err := a.PublishMqtt(connId, publishParams)
	if err != nil {
		return err
	}
	return nil
}

func (a *App) GetMatchingSubscriptionForTopic(connId uint, topic string) (*models.Subscription, error) {
	appConnection, err := getConnectedConnection(a, connId)
	if err != nil {
		return nil, err
	}
	subscription := appConnection.SubscriptionMatcher.GetMatchingSubscription(topic)
	return subscription, err
}

func getConnectedConnection(app *App, connId uint) (*AppConnection, error) {
	conn, ok := app.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found")
	}
	if conn.MqttManager.ConnectionState != mqtt.ConnectionStates.Connected {
		return nil, fmt.Errorf("specified connection not connected")
	}
	return conn, nil
}

func makePublishProperties(properties *PublishProperties) (*mqtt.MessageProperties, error) {
	if properties == nil {
		return nil, nil
	}

	var payloadFormat byte = 0
	if properties.PayloadFormatIndicator {
		payloadFormat = 1
	}

	publishProperties := mqtt.MessageProperties{
		PayloadFormat: &payloadFormat,
	}

	if properties.ContentType != "" {
		publishProperties.ContentType = properties.ContentType
	}

	if properties.ResponseTopic != "" {
		publishProperties.ResponseTopic = properties.ResponseTopic
	}

	if properties.MessageExpiryInterval > -1 {
		messageExpiry := uint32(properties.MessageExpiryInterval)
		publishProperties.MessageExpiry = &messageExpiry
	}

	if properties.TopicAlias > 0 {
		topicAlias := uint16(properties.TopicAlias)
		publishProperties.TopicAlias = &topicAlias
	}

	if properties.CorrelationData != "" {
		correlationData := []byte(properties.CorrelationData)
		publishProperties.CorrelationData = correlationData
	}

	if properties.SubscriptionIdentifier > -1 {
		subscriptionIdentifier := int(properties.SubscriptionIdentifier)
		publishProperties.SubscriptionIdentifier = &subscriptionIdentifier
	}

	if properties.UserProperties != nil {
		publishProperties.UserProperties = properties.UserProperties
	}

	return &publishProperties, nil
}

func getConnectionDetailsFromConnectionModel(connection *models.Connection) (*mqtt.MqttConnectionDetails, error) {
	details := &mqtt.MqttConnectionDetails{
		MqttVersion: connection.MqttVersion,
		Protocol:    connection.Protocol,
		Host:        connection.Host,
		Port:        connection.Port,
	}

	if connection.Username.Valid {
		details.Username = connection.Username.String
	}
	if connection.Password.Valid {
		details.Password = []byte(connection.Password.String)
	}
	if connection.ClientId.Valid {
		details.ClientId = connection.ClientId.String
	}

	if connection.IsCertsEnabled != nil && *connection.IsCertsEnabled {
		buildTlsParams := security.BuildTlsParams{}
		if connection.CertCa.Valid {
			buildTlsParams.CertCaPath = connection.CertCa.String
		}
		if connection.CertClient.Valid {
			buildTlsParams.CertClientPath = connection.CertClient.String
		}
		if connection.CertClientKey.Valid {
			buildTlsParams.CertClientKeyPath = connection.CertClientKey.String
		}
		if connection.SkipCertVerification != nil {
			buildTlsParams.SkipCertVerification = *connection.SkipCertVerification
		}
		tlsConfig, err := security.BuildTlsConfig(buildTlsParams)
		if err != nil {
			return nil, err
		}
		details.TlsConfig = tlsConfig
	}
	return details, nil
}
