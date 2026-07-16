package app

import (
	"encoding/json"
	"errors"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"strconv"

	"gorm.io/gorm"
)

// DefaultReceivedMessageWindow is the page size for timeline windowing.
const DefaultReceivedMessageWindow = 5000

// GetReceivedMessageWindow returns a page of a topic's durable history, always
// in arrival (ascending) order, via keyset pagination on id:
//
//   - afterID > 0:  the window immediately NEWER than afterID (id > afterID).
//   - else, beforeID > 0:  the window immediately OLDER than beforeID (id < beforeID).
//   - both 0:  the newest window.
//
// So "load older" passes the window's smallest id as beforeID; "load newer"
// passes its largest id as afterID. limit <= 0 uses the default window size.
func (a *App) GetReceivedMessageWindow(connectionID uint, topic string, beforeID uint, afterID uint, limit int) ([]mqtt.MqttMessage, error) {
	if limit <= 0 {
		limit = DefaultReceivedMessageWindow
	}
	query := a.Db.Where("connection_id = ? AND topic = ?", connectionID, topic)

	if afterID > 0 {
		// Forward window: oldest-first is already arrival order.
		var rows []models.ReceivedMessage
		if err := query.Where("id > ?", afterID).Order("id asc").Limit(limit).Find(&rows).Error; err != nil {
			return nil, err
		}
		out := make([]mqtt.MqttMessage, len(rows))
		for i := range rows {
			out[i] = mqttMessageFromReceived(&rows[i])
		}
		return out, nil
	}

	if beforeID > 0 {
		query = query.Where("id < ?", beforeID)
	}
	var rows []models.ReceivedMessage
	if err := query.Order("id desc").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	// Newest-first from the query; reverse to arrival order for the timeline.
	out := make([]mqtt.MqttMessage, len(rows))
	for i := range rows {
		out[len(rows)-1-i] = mqttMessageFromReceived(&rows[i])
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

// GetReceivedTimelineWindow mirrors GetReceivedMessageWindow's keyset paging
// (same beforeID/afterID/limit semantics) but selects only the stub columns
// (id, timeMs, qos, retain), never the payload. This is what the timeline
// pages through when browsing a busy topic's durable history: a window of
// 5000 stubs is a few hundred KB at most, versus potentially tens of MB if
// every row's payload were included.
func (a *App) GetReceivedTimelineWindow(connectionID uint, topic string, beforeID uint, afterID uint, limit int) ([]mqtt.MqttMessageStub, error) {
	if limit <= 0 {
		limit = DefaultReceivedMessageWindow
	}
	query := a.Db.Model(&models.ReceivedMessage{}).
		Select("id", "qo_s", "retain", "received_at").
		Where("connection_id = ? AND topic = ?", connectionID, topic)

	if afterID > 0 {
		var rows []models.ReceivedMessage
		if err := query.Where("id > ?", afterID).Order("id asc").Limit(limit).Find(&rows).Error; err != nil {
			return nil, err
		}
		out := make([]mqtt.MqttMessageStub, len(rows))
		for i := range rows {
			out[i] = stubFromReceived(&rows[i])
		}
		return out, nil
	}

	if beforeID > 0 {
		query = query.Where("id < ?", beforeID)
	}
	var rows []models.ReceivedMessage
	if err := query.Order("id desc").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	// Newest-first from the query; reverse to arrival order for the timeline.
	out := make([]mqtt.MqttMessageStub, len(rows))
	for i := range rows {
		out[len(rows)-1-i] = stubFromReceived(&rows[i])
	}
	return out, nil
}

// GetReceivedMessageById fetches a single durable message (with its full
// payload) by numeric row id, scoped to the connection/topic. Used for the
// on-demand payload fetch when a timeline stub is selected or clicked.
// found=false (no error) means the row no longer exists (e.g. pruned), so the
// frontend can render a graceful "no longer available" state.
func (a *App) GetReceivedMessageById(connectionID uint, topic string, id uint) (msg mqtt.MqttMessage, found bool, err error) {
	var row models.ReceivedMessage
	dbErr := a.Db.Where("connection_id = ? AND topic = ? AND id = ?", connectionID, topic, id).First(&row).Error
	if dbErr != nil {
		if errors.Is(dbErr, gorm.ErrRecordNotFound) {
			return mqtt.MqttMessage{}, false, nil
		}
		return mqtt.MqttMessage{}, false, dbErr
	}
	return mqttMessageFromReceived(&row), true, nil
}

// MaxReceivedMessagesByIds caps a single GetReceivedMessagesByIds batch. The
// frontend's prefetch radius bounds real batches well under this; the cap is
// a backstop so a pathological caller can't turn one bridge call into an
// unbounded IN (...) query.
const MaxReceivedMessagesByIds = 200

// GetReceivedMessagesByIds fetches a batch of durable messages (with full
// payloads) by numeric row id, scoped to the connection/topic, in ascending
// id order. Ids with no matching row are simply omitted from the result, so
// the frontend can treat them as pruned ("aged out").
func (a *App) GetReceivedMessagesByIds(connectionID uint, topic string, ids []uint) ([]mqtt.MqttMessage, error) {
	if len(ids) > MaxReceivedMessagesByIds {
		ids = ids[:MaxReceivedMessagesByIds]
	}
	if len(ids) == 0 {
		return nil, nil
	}
	var rows []models.ReceivedMessage
	err := a.Db.
		Where("connection_id = ? AND topic = ? AND id IN (?)", connectionID, topic, ids).
		Order("id asc").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]mqtt.MqttMessage, len(rows))
	for i := range rows {
		out[i] = mqttMessageFromReceived(&rows[i])
	}
	return out, nil
}

// GetDatabaseSizeBytes reports the live database size (for the settings readout).
func (a *App) GetDatabaseSizeBytes() (int64, error) {
	return a.usedBytes()
}

func stubFromReceived(row *models.ReceivedMessage) mqtt.MqttMessageStub {
	return mqtt.MqttMessageStub{
		Id:     strconv.FormatUint(uint64(row.ID), 10),
		TimeMs: row.ReceivedAt.UnixMilli(),
		QoS:    byte(row.QoS),
		Retain: row.Retain,
	}
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
