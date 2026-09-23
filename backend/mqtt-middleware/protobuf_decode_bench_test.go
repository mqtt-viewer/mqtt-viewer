package mqttmiddleware

import (
	"fmt"
	"io"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/sparkplug"
	"testing"
	"time"

	"golang.org/x/exp/slog"
)

// benchmarkDecode measures the decode middleware on a realistic NDATA: four
// alias-only metrics, as a node reporting by exception sends them.
func benchmarkDecode(b *testing.B, store *sparkplug.SessionStore) {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t := &testing.T{}
	registry := loadTestRegistry(t)
	mw := NewProtoDecodeMiddleware(registry, store)
	birth := encodeSparkplugB(t, registry, `{"seq":"0","metrics":[`+
		`{"name":"Line/Tag0","alias":"1","datatype":10,"doubleValue":1},`+
		`{"name":"Line/Tag1","alias":"2","datatype":10,"doubleValue":1},`+
		`{"name":"Line/Tag2","alias":"3","datatype":10,"doubleValue":1},`+
		`{"name":"Line/Tag3","alias":"4","datatype":10,"doubleValue":1}]}`)
	birthMsg := &mqtt.MqttMessage{Id: "birth", Topic: "spBv1.0/G/NBIRTH/N", Payload: birth, TimeMs: 1}
	if err := mw.Func(birthMsg); err != nil {
		b.Fatal(err)
	}
	payloads := make([][]byte, 256)
	for i := range payloads {
		payloads[i] = encodeSparkplugB(t, registry, fmt.Sprintf(`{"seq":"%d","metrics":[`+
			`{"alias":"1","doubleValue":%d.5},{"alias":"2","doubleValue":2},`+
			`{"alias":"3","doubleValue":3},{"alias":"4","doubleValue":4}]}`, (i+1)%256, i))
	}
	now := time.Now()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		msg := &mqtt.MqttMessage{
			Id:      "m",
			Topic:   "spBv1.0/G/NDATA/N",
			Payload: payloads[i%len(payloads)],
			TimeMs:  now.UnixMilli(),
		}
		if err := mw.Func(msg); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkDecodeStateless(b *testing.B) { benchmarkDecode(b, nil) }

func BenchmarkDecodeStateful(b *testing.B) { benchmarkDecode(b, sparkplug.NewSessionStore()) }
