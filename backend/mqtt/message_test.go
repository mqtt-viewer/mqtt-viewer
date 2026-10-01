package mqtt

import (
	"context"
	"testing"
	"time"

	mqttV3 "github.com/eclipse/paho.mqtt.golang"
)

// fakeV3Message is the minimal paho v3 message the MQTT 3 client hands to
// the default publish handler.
type fakeV3Message struct {
	topic   string
	payload []byte
}

func (m *fakeV3Message) Duplicate() bool   { return false }
func (m *fakeV3Message) Qos() byte         { return 0 }
func (m *fakeV3Message) Retained() bool    { return false }
func (m *fakeV3Message) Topic() string     { return m.topic }
func (m *fakeV3Message) MessageID() uint16 { return 0 }
func (m *fakeV3Message) Payload() []byte   { return m.payload }
func (m *fakeV3Message) Ack()              {}

// Receive middleware such as the protobuf decoder writes into
// MiddlewareProperties, so MQTT 3 messages must arrive with it initialised
// just like MQTT 5 ones. Before this was the case, enabling Sparkplug
// decoding on a v3 connection crashed the app on the first spBv1.0 message.
func TestV3MessageSupportsMiddlewareProperties(t *testing.T) {
	mm := NewMqttManager(context.Background(), nil)
	mm.UseMiddleware(MqttMiddlewares{
		BeforeAddToHistory: []Middleware[MqttMessage]{{
			ID: "test",
			Func: func(m *MqttMessage) error {
				(*m.MiddlewareProperties)["IsDecodedProto"] = true
				return nil
			},
		}},
	})

	var raw mqttV3.Message = &fakeV3Message{topic: "spBv1.0/g/DDATA/n/d", payload: []byte{0x08, 0x01}}
	if err := mm.receiveMessage(newMqttMessageFromV3(&raw, time.Now())); err != nil {
		t.Fatalf("receiveMessage: %v", err)
	}

	history := waitForHistory(t, mm, "spBv1.0/g/DDATA/n/d", 1)
	props := history[0].MiddlewareProperties
	if props == nil || (*props)["IsDecodedProto"] != true {
		t.Fatalf("expected IsDecodedProto middleware property, got %v", props)
	}
}

// Sparkplug decoding attaches a meta map to every message it handles, so the
// history budget has to count it. Before it did, a connection on a busy
// Sparkplug broker retained well over its budget.
func TestEstimatedBytesCountsMiddlewareProperties(t *testing.T) {
	plain := msg("spBv1.0/Group/NDATA/EdgeNode", 128)

	withMeta := msg("spBv1.0/Group/NDATA/EdgeNode", 128)
	withMeta.MiddlewareProperties = &map[string]any{
		"IsDecodedProto": true,
		"sparkplug": map[string]any{
			"msgType":    "NDATA",
			"group":      "Sparkplug B Devices",
			"edgeNode":   "Raspberry Pi",
			"resolution": "resolved",
			"birthAtMs":  int64(1700000000000),
			"seqGap":     map[string]any{"expected": 4, "got": 7},
		},
	}

	extra := withMeta.estimatedBytes() - plain.estimatedBytes()
	if extra < 100 {
		t.Errorf("expected sparkplug meta to add a meaningful cost, got %d extra bytes", extra)
	}
}

func TestEstimatedBytesIgnoresEmptyMiddlewareProperties(t *testing.T) {
	plain := msg("a/b", 32)
	empty := msg("a/b", 32)
	empty.MiddlewareProperties = &map[string]any{}

	if plain.estimatedBytes() != empty.estimatedBytes() {
		t.Errorf("expected an empty middleware map to cost nothing extra, got %d vs %d",
			empty.estimatedBytes(), plain.estimatedBytes())
	}
}

// Depth limiting keeps the estimate cheap on the receive path; a deeply nested
// value must still terminate at a bounded cost rather than walking every level.
func TestEstimatedValueBytesIsDepthLimited(t *testing.T) {
	deep := map[string]any{"a": map[string]any{"b": map[string]any{"c": map[string]any{"d": "unreachable"}}}}
	if got := estimatedValueBytes(deep, maxValueDepth); got > 4*nestedFlatCost {
		t.Errorf("expected a bounded cost for a deeply nested value, got %d", got)
	}
}
