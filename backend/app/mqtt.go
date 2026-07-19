package app

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/security"
	topicmatching "mqtt-viewer/backend/topic-matching"
	"sort"
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

	// Always reload the sub matcher, subscriptions may have changed
	appConnection.SubscriptionMatcher = topicmatching.NewSubscriptionMatcher(subscriptions)

	protoRules := []models.ProtoBindingRule{}
	if err = a.Db.Where("connection_id = ?", connId).Order("sort_order, id").Find(&protoRules).Error; err != nil {
		return err
	}
	protoEnabled := connection.IsProtoEnabled != nil && *connection.IsProtoEnabled
	appConnection.ProtoState.SetEnabled(protoEnabled)
	appConnection.ProtoState.SetRules(protoRules)

	protoDir := a.protoImportDir(connId)
	if protoEnabled && appConnection.ProtoState.NeedsLoad(protoDir) {
		// refreshProtoImportState compiles the internal proto-imports copy
		// (or clears protoState if nothing has been imported) and emits
		// ProtoStateChanged regardless of outcome, so a compile warning at
		// connect time reaches every open window.
		if _, err := a.refreshProtoImportState(connId); err != nil {
			slog.Error(err.Error())
		}
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
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return fmt.Errorf("connection not found (%d)", connId)
	}
	appConnection.MqttManager.Disconnect(nil)
	return nil
}

func (a *App) GetMessageHistory(connId uint, topic string) ([]mqtt.MqttMessage, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	messageHistory, err := appConnection.MqttManager.MessageHistory.GetTopicHistory(topic)
	if err != nil {
		return nil, err
	}
	return messageHistory, nil
}

// GetSysMessageHistory returns every retained $SYS/* message for a
// connection, flattened across topics and sorted by arrival time, so a
// broker-status window opened mid-session starts populated.
func (a *App) GetSysMessageHistory(connId uint) ([]mqtt.MqttMessage, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	// Prefix-filter inside the history lock so we only copy $SYS/* messages,
	// rather than struct-copying the entire retained window under the ingest
	// mutex (GetAllHistory).
	messages := appConnection.MqttManager.MessageHistory.GetHistoryByTopicPrefix("$SYS/")
	sortMessagesByTimeAsc(messages)
	return messages, nil
}

// sortMessagesByTimeAsc orders messages by arrival time ascending, stably.
// Pure so it is testable without a broker.
func sortMessagesByTimeAsc(messages []mqtt.MqttMessage) {
	sort.SliceStable(messages, func(i, j int) bool {
		return messages[i].TimeMs < messages[j].TimeMs
	})
}

func (a *App) ClearConnectionHistory(connId uint) error {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return fmt.Errorf("connection not found (%d)", connId)
	}
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
	// nil = auto (matcher decides), "" = raw (skip protobuf encoding),
	// "<name>" = forced message type.
	ProtoOverride *string `json:"protoOverride"`
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
		Topic:         message.Topic,
		QoS:           message.QoS,
		Payload:       bytesPayload,
		Retain:        message.Retain,
		Properties:    properties,
		ProtoOverride: message.ProtoOverride,
	}
	err = appConnection.MqttManager.Publish(mqttPublishParams)
	if err != nil {
		return err
	}
	return nil
}

func (a *App) DeleteRetainedMessage(connId uint, topic string) error {
	raw := ""
	publishParams := PublishParams{
		Topic:         topic,
		QoS:           0,
		Payload:       "",
		Retain:        true,
		ProtoOverride: &raw,
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
		MqttVersion:   connection.MqttVersion,
		Protocol:      connection.Protocol,
		Host:          connection.Host,
		Port:          connection.Port,
		WebsocketPath: connection.WebsocketPath,
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
