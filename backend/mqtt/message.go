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

// MqttMessageStub is the lightweight projection of MqttMessage used to
// populate the selection timeline: everything the timeline needs to render a
// dot (id, arrival time, qos/retain flags) but never the payload. Selecting a
// busy topic (potentially 150k+ stored messages) fetches a bounded window of
// these instead of full messages, so the bridge never has to serialize tens
// of MB of payload just to draw dots on a timeline. Payloads are fetched
// individually, on demand, via GetMessageById/GetMessageTimeline callers.
type MqttMessageStub struct {
	Id     string `json:"id"`
	TimeMs int64  `json:"timeMs"`
	QoS    byte   `json:"qos"`
	Retain bool   `json:"retain"`
}

// Stub projects a full message down to its timeline stub.
func (m *MqttMessage) Stub() MqttMessageStub {
	return MqttMessageStub{
		Id:     m.Id,
		TimeMs: m.TimeMs,
		QoS:    m.QoS,
		Retain: m.Retain,
	}
}

// estimatedBytes approximates the heap cost of retaining this message, used to
// keep the in-memory history under its byte budget. It need not be exact —
// just proportional and dominated by the variable parts (payload, topic,
// properties) so eviction tracks real memory growth. Calibrated 2026-07-19
// against flood-shaped messages: accounted ~380 B/msg vs ~266 B/msg real live
// heap (ratio 0.70), i.e. deliberately conservative — see
// history_calibration_test.go.
func (m *MqttMessage) estimatedBytes() int {
	// Fixed per-message overhead: struct fields, id/uuid and time.Time.
	const baseOverhead = 256
	n := baseOverhead + len(m.Topic) + len(m.Payload) + len(m.Id)
	if m.Properties != nil {
		// v5 always allocates the properties struct plus the UserProperties and
		// MiddlewareProperties maps, measured at ~450 B beyond the counted strings.
		const v5Overhead = 448
		n += v5Overhead
		n += len(m.Properties.CorrelationData) +
			len(m.Properties.ContentType) +
			len(m.Properties.ResponseTopic)
		for key, value := range m.Properties.UserProperties {
			n += len(key) + len(value) + 16
		}
	}
	// Middleware properties are no longer just flags: the Sparkplug decode
	// attaches a per-message meta map, which history would otherwise retain
	// entirely off-budget and under-evict.
	if m.MiddlewareProperties != nil {
		for key, value := range *m.MiddlewareProperties {
			n += len(key) + mapEntryOverhead + estimatedValueBytes(value, maxValueDepth)
		}
	}
	return n
}

const (
	// mapEntryOverhead approximates a Go map bucket slot plus the interface
	// header the value is boxed in.
	mapEntryOverhead = 32
	// nestedFlatCost stands in for a container past maxValueDepth, so a
	// pathologically nested value costs a constant rather than a full walk.
	nestedFlatCost = 64
	maxValueDepth  = 2
)

// estimatedValueBytes approximates the retained size of a middleware property
// value. Depth-limited on purpose: this runs per message on the receive path
// and again on every eviction, so it must stay cheap and never recurse deeply.
func estimatedValueBytes(value any, depth int) int {
	switch v := value.(type) {
	case string:
		return len(v)
	case []byte:
		return len(v)
	case bool, int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64, float32, float64:
		return 8
	case map[string]any:
		if depth <= 0 {
			return nestedFlatCost
		}
		n := 0
		for key, nested := range v {
			n += len(key) + mapEntryOverhead + estimatedValueBytes(nested, depth-1)
		}
		return n
	case []any:
		if depth <= 0 {
			return nestedFlatCost
		}
		n := 0
		for _, item := range v {
			n += estimatedValueBytes(item, depth-1)
		}
		return n
	default:
		return 16
	}
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

	message.MiddlewareProperties = &map[string]any{}
	return &message
}
