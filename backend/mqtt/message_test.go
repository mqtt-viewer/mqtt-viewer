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
