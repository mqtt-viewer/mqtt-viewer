package mqtt

import (
	"time"

	mqttV5 "github.com/eclipse/paho.golang/paho"
	mqttV3 "github.com/eclipse/paho.mqtt.golang"
	"github.com/google/uuid"
)

type MqttMessage struct {
	Id                   string             `json:"id"`
	Topic                string             `json:"topic"`
	Payload              []byte             `json:"payload"`
	QoS                  byte               `json:"qos"`
	Retain               bool               `json:"retain"`
	Properties           *MessageProperties `json:"properties,omitempty"`
	TimeMs               int64              `json:"timeMs"`
	MiddlewareProperties *map[string]any    `json:"middlewareProperties,omitempty"`
	Time                 time.Time
}

// estimatedBytes approximates the heap cost of retaining this message, used to
// keep the in-memory history under its byte budget. It need not be exact —
// just proportional and dominated by the variable parts (payload, topic,
// properties) so eviction tracks real memory growth.
func (m *MqttMessage) estimatedBytes() int {
	// Fixed per-message overhead: struct fields, id/uuid, time.Time, and the
	// always-allocated property/middleware map headers for v5 messages.
	const baseOverhead = 256
	n := baseOverhead + len(m.Topic) + len(m.Payload) + len(m.Id)
	if m.Properties != nil {
		n += len(m.Properties.CorrelationData) +
			len(m.Properties.ContentType) +
			len(m.Properties.ResponseTopic)
		for key, value := range m.Properties.UserProperties {
			n += len(key) + len(value) + 16
		}
	}
	return n
}

type MessageProperties struct {
	CorrelationData        []byte            `json:"correlationData"`
	ContentType            string            `json:"contentType"`
	ResponseTopic          string            `json:"responseTopic"`
	PayloadFormat          *byte             `json:"payloadFormat"`
	MessageExpiry          *uint32           `json:"messageExpiry"`
	SubscriptionIdentifier *int              `json:"subscriptionIdentifier"`
	TopicAlias             *uint16           `json:"topicAlias"`
	UserProperties         map[string]string `json:"userProperties"`
}

func newMqttMessageFromV5(m *mqttV5.Publish, arrivedAt time.Time) *MqttMessage {
	message := MqttMessage{
		Id:      uuid.New().String(),
		Topic:   m.Topic,
		Payload: m.Payload,
		QoS:     m.QoS,
		Retain:  m.Retain,
		Properties: &MessageProperties{
			CorrelationData:        m.Properties.CorrelationData,
			ContentType:            m.Properties.ContentType,
			ResponseTopic:          m.Properties.ResponseTopic,
			PayloadFormat:          m.Properties.PayloadFormat,
			MessageExpiry:          m.Properties.MessageExpiry,
			SubscriptionIdentifier: m.Properties.SubscriptionIdentifier,
			TopicAlias:             m.Properties.TopicAlias,
		},
		TimeMs: arrivedAt.UnixMilli(),
		Time:   arrivedAt,
	}

	userProperties := make(map[string]string)
	for _, userProp := range m.Properties.User {
		userProperties[userProp.Key] = userProp.Value
	}
	message.Properties.UserProperties = userProperties
	message.MiddlewareProperties = &map[string]any{}
	return &message
}

func newMqttMessageFromV3(m *mqttV3.Message, arrivedAt time.Time) *MqttMessage {
	message := MqttMessage{
		Id:      uuid.New().String(),
		Topic:   (*m).Topic(),
		Payload: (*m).Payload(),
		QoS:     (*m).Qos(),
		Retain:  (*m).Retained(),
		TimeMs:  arrivedAt.UnixMilli(),
		Time:    arrivedAt,
	}

	return &message
}
