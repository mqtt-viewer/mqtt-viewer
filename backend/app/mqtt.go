package app

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	mqttmiddleware "mqtt-viewer/backend/mqtt-middleware"
	"mqtt-viewer/backend/security"
	topicmatching "mqtt-viewer/backend/topic-matching"
	"sort"
	"strings"
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
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return fmt.Errorf("connection not found (%d)", connId)
	}
	appConnection.MqttManager.Disconnect(nil)
	return nil
}

// GetMessageHistory returns up to `limit` of the newest retained messages for
// a topic (limit <= 0 returns everything). The UI passes its window size:
// returning a busy topic's entire RAM history serializes an unbounded JSON
// blob across the webview bridge, which crashed the app on huge
// public-broker topics.
func (a *App) GetMessageHistory(connId uint, topic string, limit int) ([]mqtt.MqttMessage, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
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
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	stubs, err := appConnection.MqttManager.MessageHistory.GetTopicTimelineWindow(topic, limit)
	if err != nil {
		return nil, err
	}
	return stubs, nil
}

// GetMessageById fetches a single full message (with its payload) by id from
// a topic's in-RAM history. timeMs is the message's receive time from its
// stub; it lets the lookup binary-search the history window instead of
// scanning it (pass 0 when unknown). found=false (no error) means the message
// has aged out of the RAM window (evicted by the memory budget), so the
// frontend can render a graceful "no longer available" state instead of an
// error.
func (a *App) GetMessageById(connId uint, topic string, id string, timeMs int64) (msg mqtt.MqttMessage, found bool) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		// a call racing connection teardown: treat as aged out, not a panic
		return mqtt.MqttMessage{}, false
	}
	return appConnection.MqttManager.MessageHistory.GetMessageById(topic, id, timeMs)
}

// GetMessagesByIds fetches a batch of full messages (with payloads) by id
// from a topic's in-RAM history. ids and timesMs are parallel slices (the
// stubs' receive times drive the same fast lookup as GetMessageById). Only
// the messages still retained are returned; the frontend treats any omitted
// id as aged out.
func (a *App) GetMessagesByIds(connId uint, topic string, ids []string, timesMs []int64) ([]mqtt.MqttMessage, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	return appConnection.MqttManager.MessageHistory.GetMessagesByIds(topic, ids, timesMs), nil
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

// MaxBulkRetainedClear caps a single bulk clear. Each topic is a separate QoS 1
// publish with its own round trip, so an unbounded sweep is minutes of blocked
// work with no way out. Above this the caller is told to narrow the branch.
const MaxBulkRetainedClear = 1000

// bulkClearBatch bounds how many publishes DeleteRetainedMessages fires before
// yielding. Each publish blocks on its PUBACK, so the yield keeps a long sweep
// from monopolising the caller for its whole duration.
const bulkClearBatch = 50

// isBrokerReservedTopic reports whether a topic sits in the broker's own
// namespace. Topic names beginning with $ are reserved for the server
// ($SYS/... on most brokers), and are never ours to retain or clear. Mirrors
// mqtt.isBrokerReservedTopic, which is unexported to that package.
func isBrokerReservedTopic(topic string) bool {
	return strings.HasPrefix(topic, "$")
}

// DeleteRetainedMessage clears the retained message on a topic by publishing
// a zero-length retained payload to it.
func (a *App) DeleteRetainedMessage(connId uint, topic string) error {
	if isBrokerReservedTopic(topic) {
		return fmt.Errorf("won't clear %s: topics under $ belong to the broker", topic)
	}

	publishParams := PublishParams{
		Topic: topic,
		// QoS 1, not 0: with QoS 0, "cleared" is a guess, since a dropped or
		// ACL-denied publish looks exactly like success. QoS 1 means the
		// broker acknowledged it.
		QoS:     1,
		Payload: "",
		Retain:  true,
	}
	err := a.PublishMqtt(connId, publishParams)
	if err != nil {
		return err
	}
	// Clearing a retained message is only echoed back to us on MQTT 5
	// (RetainAsPublished), so under MQTT 3 the index would stay marked
	// forever unless we unmark it here ourselves. See
	// MessageHistory.UnmarkRetained.
	if appConnection, ok := a.AppConnections[connId]; ok {
		appConnection.MqttManager.MessageHistory.UnmarkRetained(topic)
	}
	return nil
}

// GetRetainedTopicsUnderPrefix returns the known-retained topics at or below a
// topic prefix, sorted, excluding broker-reserved ($) topics. It backs the
// count shown before a bulk retained cleanup.
//
// "Known" is doing real work here: this reflects the retained messages this
// session has seen, not the broker's true retained set (see
// mqtt.MessageHistory's retained field). UI copy must not present it as
// complete.
func (a *App) GetRetainedTopicsUnderPrefix(connId uint, prefix string) ([]string, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	return appConnection.MqttManager.MessageHistory.RetainedUnderPrefix(prefix), nil
}

// ClearRetainedResult reports what a bulk clear actually did. The UI states a
// number to the user, so it must come from attempted publishes rather than
// from the size of the list we were handed.
type ClearRetainedResult struct {
	Cleared int `json:"cleared"`
	Failed  int `json:"failed"`
	// FirstError names one failure so the user has something to act on.
	FirstError string `json:"firstError"`
}

// DeleteRetainedMessages clears the retained message on each of the given
// topics by publishing a zero-length retained payload to it.
//
// It takes an explicit topic list rather than a prefix so the caller clears
// exactly the topics it counted and showed the user. Re-resolving a prefix here
// would race live traffic: a topic retained between the confirmation opening
// and the user accepting it would be swept up silently, making the number they
// agreed to a lie.
//
// Every topic is attempted even if earlier ones fail, because a half-cleared
// branch that reports nothing is worse than a full attempt that reports what
// broke. The result carries how many succeeded and how many failed; a non-nil
// error means the call was refused outright and nothing was attempted.
func (a *App) DeleteRetainedMessages(connId uint, topics []string) (ClearRetainedResult, error) {
	if len(topics) == 0 {
		return ClearRetainedResult{}, nil
	}
	if len(topics) > MaxBulkRetainedClear {
		return ClearRetainedResult{}, fmt.Errorf(
			"won't clear %d retained messages at once, the limit is %d: pick a narrower branch",
			len(topics), MaxBulkRetainedClear,
		)
	}
	for _, topic := range topics {
		// GetRetainedTopicsUnderPrefix already excludes these, so one arriving
		// here means the list did not come from us.
		if isBrokerReservedTopic(topic) {
			return ClearRetainedResult{}, fmt.Errorf("won't clear %s: topics under $ belong to the broker", topic)
		}
	}

	var result ClearRetainedResult
	for i, topic := range topics {
		if i > 0 && i%bulkClearBatch == 0 {
			time.Sleep(10 * time.Millisecond)
		}
		if err := a.DeleteRetainedMessage(connId, topic); err != nil {
			result.Failed++
			if result.FirstError == "" {
				result.FirstError = fmt.Sprintf("%s: %s", topic, err.Error())
			}
			continue
		}
		result.Cleared++
	}
	return result, nil
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
