package app

import (
	"encoding/json"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"strconv"
)

// DefaultReceivedMessageWindow is the page size for timeline windowing.
const DefaultReceivedMessageWindow = 5000

// GetReceivedMessageWindow returns a page of a topic's durable history in
// arrival (ascending) order. Pages newest-first via keyset pagination: pass
// beforeID = 0 for the newest window, then the smallest id of the returned
// page as beforeID to fetch the next-older window. limit <= 0 uses the default.
func (a *App) GetReceivedMessageWindow(connectionID uint, topic string, beforeID uint, limit int) ([]mqtt.MqttMessage, error) {
	if limit <= 0 {
		limit = DefaultReceivedMessageWindow
	}
	query := a.Db.Where("connection_id = ? AND topic = ?", connectionID, topic)
	if beforeID > 0 {
		query = query.Where("id < ?", beforeID)
	}
	var rows []models.ReceivedMessage
	if err := query.Order("id desc").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	// rows are newest-first; reverse to arrival order for the timeline.
	out := make([]mqtt.MqttMessage, len(rows))
	for i, row := range rows {
		out[len(rows)-1-i] = mqttMessageFromReceived(&row)
	}
	return out, nil
}

// GetReceivedMessageCount returns how many durable messages exist for a topic
// (drives the window-count UI).
func (a *App) GetReceivedMessageCount(connectionID uint, topic string) (int64, error) {
	var count int64
	err := a.Db.Model(&models.ReceivedMessage{}).
		Where("connection_id = ? AND topic = ?", connectionID, topic).
		Count(&count).Error
	return count, err
}

// GetDatabaseSizeBytes reports the live database size (for the settings readout).
func (a *App) GetDatabaseSizeBytes() (int64, error) {
	return a.usedBytes()
}

func mqttMessageFromReceived(row *models.ReceivedMessage) mqtt.MqttMessage {
	msg := mqtt.MqttMessage{
		Id:      strconv.FormatUint(uint64(row.ID), 10),
		Topic:   row.Topic,
		Payload: row.Payload,
		QoS:     byte(row.QoS),
		Retain:  row.Retain,
		TimeMs:  row.ReceivedAt.UnixMilli(),
		Time:    row.ReceivedAt,
	}
	hasProps := row.UserProperties != nil || row.HeaderContentType != nil ||
		row.HeaderResponseTopic != nil || row.HeaderCorrelationData != nil ||
		row.HeaderPayloadFormatIndicator != nil || row.HeaderMessageExpiryInterval != nil ||
		row.HeaderTopicAlias != nil || row.HeaderSubscriptionIdentifier != nil
	if !hasProps {
		return msg
	}
	props := &mqtt.MessageProperties{UserProperties: map[string]string{}}
	if row.UserProperties != nil {
		_ = json.Unmarshal([]byte(*row.UserProperties), &props.UserProperties)
	}
	if row.HeaderContentType != nil {
		props.ContentType = *row.HeaderContentType
	}
	if row.HeaderResponseTopic != nil {
		props.ResponseTopic = *row.HeaderResponseTopic
	}
	if row.HeaderCorrelationData != nil {
		props.CorrelationData = []byte(*row.HeaderCorrelationData)
	}
	if row.HeaderPayloadFormatIndicator != nil {
		var pf byte
		if *row.HeaderPayloadFormatIndicator {
			pf = 1
		}
		props.PayloadFormat = &pf
	}
	if row.HeaderMessageExpiryInterval != nil {
		v := uint32(*row.HeaderMessageExpiryInterval)
		props.MessageExpiry = &v
	}
	if row.HeaderTopicAlias != nil {
		v := uint16(*row.HeaderTopicAlias)
		props.TopicAlias = &v
	}
	if row.HeaderSubscriptionIdentifier != nil {
		v := int(*row.HeaderSubscriptionIdentifier)
		props.SubscriptionIdentifier = &v
	}
	msg.Properties = props
	return msg
}
