package app

import (
	"encoding/json"
	"log/slog"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
)

// receivedMessageInsertBatch caps rows per INSERT so a busy 300ms drain stays
// within one short transaction.
const receivedMessageInsertBatch = 200

// loadRetentionSettings primes the cached recording flag + disk budget from the
// settings row. Called at startup and whenever settings change.
func (a *App) loadRetentionSettings() {
	settings, err := a.GetAppSettings()
	if err != nil {
		slog.Error("failed to load retention settings", "error", err)
		return
	}
	a.recordingEnabled.Store(settings.RecordingEnabled)
	a.diskBudgetBytes.Store(settings.DiskBudgetBytes)
}

// recordReceivedMessages persists a drained batch to the durable store when
// recording is enabled. No-op (and no DB cost) when disabled.
func (a *App) recordReceivedMessages(connectionID uint, messages []mqtt.MqttMessage) {
	if !a.recordingEnabled.Load() || len(messages) == 0 {
		return
	}
	rows := make([]models.ReceivedMessage, 0, len(messages))
	for i := range messages {
		rows = append(rows, receivedMessageFromMqtt(connectionID, &messages[i]))
	}
	if err := a.Db.CreateInBatches(rows, receivedMessageInsertBatch).Error; err != nil {
		slog.Error("failed to persist received messages", "error", err, "count", len(rows))
		return
	}
	a.pruneReceivedMessagesToBudget()
}

func receivedMessageFromMqtt(connectionID uint, m *mqtt.MqttMessage) models.ReceivedMessage {
	row := models.ReceivedMessage{
		ConnectionID: connectionID,
		Topic:        m.Topic,
		QoS:          uint(m.QoS),
		Retain:       m.Retain,
		Payload:      m.Payload,
		ReceivedAt:   m.Time,
	}
	props := m.Properties
	if props == nil {
		return row
	}
	if len(props.UserProperties) > 0 {
		if encoded, err := json.Marshal(props.UserProperties); err == nil {
			s := string(encoded)
			row.UserProperties = &s
		}
	}
	if props.ContentType != "" {
		s := props.ContentType
		row.HeaderContentType = &s
	}
	if props.ResponseTopic != "" {
		s := props.ResponseTopic
		row.HeaderResponseTopic = &s
	}
	if len(props.CorrelationData) > 0 {
		s := string(props.CorrelationData)
		row.HeaderCorrelationData = &s
	}
	if props.PayloadFormat != nil {
		b := *props.PayloadFormat == 1
		row.HeaderPayloadFormatIndicator = &b
	}
	if props.MessageExpiry != nil {
		v := int32(*props.MessageExpiry)
		row.HeaderMessageExpiryInterval = &v
	}
	if props.TopicAlias != nil {
		v := int32(*props.TopicAlias)
		row.HeaderTopicAlias = &v
	}
	if props.SubscriptionIdentifier != nil {
		v := int32(*props.SubscriptionIdentifier)
		row.HeaderSubscriptionIdentifier = &v
	}
	return row
}
