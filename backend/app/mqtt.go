package app

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	mqttmiddleware "mqtt-viewer/backend/mqtt-middleware"
	"mqtt-viewer/backend/security"
	topicmatching "mqtt-viewer/backend/topic-matching"
	"time"
)

const MQTT_BUFFER_EMIT_INTERVAL = 300 * time.Millisecond

func (a *App) ConnectMqtt(connId uint) error {
	var err error
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return fmt.Errorf("connection not found (%d)", connId)
	}

	connection := models.Connection{}
	err = a.Db.First(&connection, connId).Error
	if err != nil {
		return err
	}

	subscriptions := []models.Subscription{}
	err = a.Db.Where("connection_id = ?", connId).Find(&subscriptions).Error
	if err != nil {
		return err
	}

	// Always reload the sub matcher / proto matcher, subscriptions may have changed
	appConnection.SubscriptionMatcher = topicmatching.NewSubscriptionMatcher(subscriptions)

	// Add protobuf middlewares if enabled
	if connection.IsProtoEnabled != nil && *connection.IsProtoEnabled && a.ProtoRegistry != nil {
		// TODO: load sparkplug proto registry
		appConnection.MqttManager.UseMiddleware(mqtt.MqttMiddlewares{
			BeforePublish: []mqtt.Middleware[mqtt.MqttPublishParams]{
				mqttmiddleware.NewProtoEncodeMiddleware(a.ProtoRegistry).Middleware,
			},
			BeforeAddToHistory: []mqtt.Middleware[mqtt.MqttMessage]{
				mqttmiddleware.NewProtoDecodeMiddleware(a.ProtoRegistry).Middleware,
			},
		})
	} else {
		appConnection.MqttManager.UseMiddleware(mqtt.MqttMiddlewares{})
	}

	connectionDetails, err := getConnectionDetailsFromConnectionModel(&connection)
	if err != nil {
		slog.Error(err.Error())
		return err
	}

	subs := make([]mqtt.SubscribeParams, len(subscriptions))
	for i, sub := range subscriptions {
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

// GetMessageHistory returns up to `limit` of the newest retained messages for
// a topic (limit <= 0 returns everything). The UI passes its window size:
// returning a busy topic's entire RAM history serializes an unbounded JSON
// blob across the webview bridge, which crashed the app on huge
// public-broker topics.
func (a *App) GetMessageHistory(connId uint, topic string, limit int) ([]mqtt.MqttMessage, error) {
	appConnection := a.AppConnections[connId]
	messageHistory, err := appConnection.MqttManager.MessageHistory.GetTopicHistoryWindow(topic, limit)
	if err != nil {
		return nil, err
	}
	return messageHistory, nil
}

// GetMessageTimeline returns up to `limit` of the newest retained messages
// for a topic as lightweight stubs (id, timeMs, qos, retain, no payload).
// This is the memory-mode counterpart to GetReceivedTimelineWindow: selecting
// a topic fetches stubs to draw the timeline, then fetches individual
// payloads on demand via GetMessageById.
func (a *App) GetMessageTimeline(connId uint, topic string, limit int) ([]mqtt.MqttMessageStub, error) {
	appConnection := a.AppConnections[connId]
	stubs, err := appConnection.MqttManager.MessageHistory.GetTopicTimelineWindow(topic, limit)
	if err != nil {
		return nil, err
	}
	return stubs, nil
}

// GetMessageById fetches a single full message (with its payload) by id from
// a topic's in-RAM history. found=false (no error) means the message has
// aged out of the RAM window (evicted by the memory budget), so the frontend
// can render a graceful "no longer available" state instead of an error.
func (a *App) GetMessageById(connId uint, topic string, id string) (msg mqtt.MqttMessage, found bool) {
	appConnection := a.AppConnections[connId]
	return appConnection.MqttManager.MessageHistory.GetMessageById(topic, id)
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

	// properties.SubscriptionIdentifier is intentionally ignored — it is a
	// broker-to-client property and must not appear in a client PUBLISH
	// [MQTT-3.3.4-6].

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

	if connection.Username != nil {
		details.Username = *connection.Username
	}
	if connection.Password != nil {
		details.Password = []byte(*connection.Password)
	}
	if connection.ClientId != nil {
		details.ClientId = *connection.ClientId
	}

	if connection.IsCertsEnabled != nil && *connection.IsCertsEnabled {
		buildTlsParams := security.BuildTlsParams{}
		if connection.CertCa != nil {
			buildTlsParams.CertCaPath = *connection.CertCa
		}
		if connection.CertClient != nil {
			buildTlsParams.CertClientPath = *connection.CertClient
		}
		if connection.CertClientKey != nil {
			buildTlsParams.CertClientKeyPath = *connection.CertClientKey
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
