package mqttmiddleware

import (
	"encoding/json"
	"fmt"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	"mqtt-viewer/backend/sparkplug"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protowire"
)

func loadTestRegistry(t *testing.T) *protobuf.ProtoRegistry {
	t.Helper()
	dir := t.TempDir()
	if err := protobuf.WriteSparkplugProtoFiles(dir); err != nil {
		t.Fatalf("writing sparkplug proto files: %v", err)
	}
	registry, err := protobuf.LoadProtoRegistry(dir)
	if err != nil {
		t.Fatalf("loading proto registry: %v", err)
	}
	return registry
}

func encodeSparkplugB(t *testing.T, registry *protobuf.ProtoRegistry, jsonPayload string) []byte {
	t.Helper()
	descriptor, ok := registry.GetMessageDescriptorFromName("SparkplugBPayload")
	if !ok {
		t.Fatal("SparkplugBPayload descriptor not found")
	}
	protoBytes, err := protobuf.EncodeFromJSONBytes([]byte(jsonPayload), descriptor)
	if err != nil {
		t.Fatalf("encoding test payload: %v", err)
	}
	return protoBytes
}

var testMessageCounter int

func runMiddleware(t *testing.T, mw *ProtoDecodeMiddleware, topic string, payload []byte) *mqtt.MqttMessage {
	t.Helper()
	// MiddlewareProperties deliberately nil: v3 messages historically arrived
	// without one, and the middleware must tolerate it.
	now := time.Now()
	testMessageCounter++
	msg := &mqtt.MqttMessage{
		Id:      fmt.Sprintf("test-%d", testMessageCounter),
		Topic:   topic,
		Payload: payload,
		Time:    now,
		TimeMs:  now.UnixMilli(),
	}
	if err := mw.Func(msg); err != nil {
		t.Fatalf("middleware error: %v", err)
	}
	return msg
}

func sparkplugMeta(t *testing.T, msg *mqtt.MqttMessage) map[string]any {
	t.Helper()
	if msg.MiddlewareProperties == nil {
		t.Fatal("expected middleware properties to be set")
	}
	meta, ok := (*msg.MiddlewareProperties)["sparkplug"].(map[string]any)
	if !ok {
		t.Fatalf("expected sparkplug meta, got %v", *msg.MiddlewareProperties)
	}
	return meta
}

func TestDecodeMiddlewareHasItsOwnID(t *testing.T) {
	mw := NewProtoDecodeMiddleware(nil, nil)
	if mw.ID != PROTO_DECODE_MIDDLEWARE_ID {
		t.Errorf("expected ID %q, got %q", PROTO_DECODE_MIDDLEWARE_ID, mw.ID)
	}
	if mw.ID == PROTO_ENCODE_MIDDLEWARE_ID {
		t.Error("decode middleware must not reuse the encode middleware ID")
	}
}

func TestStatefulDecodeInjectsNamesAndMeta(t *testing.T) {
	registry := loadTestRegistry(t)
	store := sparkplug.NewSessionStore()
	mw := NewProtoDecodeMiddleware(registry, store)

	birth := encodeSparkplugB(t, registry,
		`{"seq":"0","metrics":[{"name":"Volts/L1","alias":"3","datatype":10,"doubleValue":240.1}]}`)
	msg := runMiddleware(t, mw, "spBv1.0/G/NBIRTH/N", birth)
	meta := sparkplugMeta(t, msg)
	if meta["msgType"] != "NBIRTH" {
		t.Errorf("expected NBIRTH meta, got %v", meta)
	}
	if (*msg.MiddlewareProperties)["IsDecodedProto"] != true {
		t.Error("expected IsDecodedProto true on birth")
	}

	data := encodeSparkplugB(t, registry,
		`{"seq":"1","metrics":[{"alias":"3","datatype":10,"doubleValue":239.9}]}`)
	msg = runMiddleware(t, mw, "spBv1.0/G/NDATA/N", data)
	meta = sparkplugMeta(t, msg)
	if meta["resolution"] != sparkplug.ResolutionResolved {
		t.Errorf("expected resolved, got %v", meta["resolution"])
	}
	if !strings.Contains(string(msg.Payload), `"Volts/L1"`) {
		t.Errorf("expected injected name in stored payload, got %s", msg.Payload)
	}
}

func TestStateTopicSkipsProtoDecode(t *testing.T) {
	registry := loadTestRegistry(t)
	store := sparkplug.NewSessionStore()
	mw := NewProtoDecodeMiddleware(registry, store)

	payload := []byte(`{"online":true,"timestamp":1752800000000}`)
	msg := runMiddleware(t, mw, "spBv1.0/STATE/scada-primary", payload)
	meta := sparkplugMeta(t, msg)
	if meta["msgType"] != "STATE" || meta["hostId"] != "scada-primary" {
		t.Errorf("unexpected STATE meta: %v", meta)
	}
	if string(msg.Payload) != string(payload) {
		t.Errorf("expected STATE payload untouched, got %s", msg.Payload)
	}
	if _, ok := (*msg.MiddlewareProperties)["IsDecodedProto"]; ok {
		t.Error("expected no IsDecodedProto on STATE")
	}

	legacy := runMiddleware(t, mw, "STATE/scada-primary", []byte("ONLINE"))
	meta = sparkplugMeta(t, legacy)
	if meta["hostId"] != "scada-primary" {
		t.Errorf("unexpected legacy STATE meta: %v", meta)
	}
	if string(legacy.Payload) != "ONLINE" {
		t.Errorf("expected legacy STATE payload untouched, got %s", legacy.Payload)
	}
}

// Topics under spBv1.0/ that fail the strict grammar keep the old stateless
// decode so nothing regresses.
func TestBadGrammarFallsBackToStatelessDecode(t *testing.T) {
	registry := loadTestRegistry(t)
	store := sparkplug.NewSessionStore()
	mw := NewProtoDecodeMiddleware(registry, store)

	payload := encodeSparkplugB(t, registry,
		`{"seq":"0","metrics":[{"name":"Volts/L1","datatype":10,"doubleValue":240.1}]}`)
	msg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N/not-valid-for-n-type", payload)
	if (*msg.MiddlewareProperties)["IsDecodedProto"] != true {
		t.Error("expected stateless decode for bad-grammar spBv1.0 topic")
	}
	if _, ok := (*msg.MiddlewareProperties)["sparkplug"]; ok {
		t.Error("expected no sparkplug meta for bad-grammar topic")
	}
	if !strings.Contains(string(msg.Payload), `"Volts/L1"`) {
		t.Errorf("expected decoded payload, got %s", msg.Payload)
	}
}

func TestUndecodablePayloadLeftRaw(t *testing.T) {
	registry := loadTestRegistry(t)
	store := sparkplug.NewSessionStore()
	mw := NewProtoDecodeMiddleware(registry, store)

	raw := []byte{0xff, 0xff, 0xff, 0xff}
	msg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", raw)
	if string(msg.Payload) != string(raw) {
		t.Errorf("expected raw payload preserved, got %v", msg.Payload)
	}
	if msg.MiddlewareProperties != nil {
		if _, ok := (*msg.MiddlewareProperties)["sparkplug"]; ok {
			t.Error("expected no sparkplug meta for undecodable payload")
		}
	}
}

func TestNilStoreKeepsStatelessBehaviour(t *testing.T) {
	registry := loadTestRegistry(t)
	mw := NewProtoDecodeMiddleware(registry, nil)

	payload := encodeSparkplugB(t, registry,
		`{"seq":"1","metrics":[{"alias":"3","datatype":10,"doubleValue":239.9}]}`)
	msg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", payload)
	if (*msg.MiddlewareProperties)["IsDecodedProto"] != true {
		t.Error("expected stateless decode with nil store")
	}
	if _, ok := (*msg.MiddlewareProperties)["sparkplug"]; ok {
		t.Error("expected no sparkplug meta with nil store")
	}
}

// wireNBirthInvalidUTF8Name hand-builds an NBIRTH payload (seq=0, one
// metric: name=0xff 0xfe 0x00, alias=3) on the wire. proto2 lets
// proto.Unmarshal accept the invalid-UTF-8 name; protojson.Marshal later
// rejects it, which is the failure this test exercises.
func wireNBirthInvalidUTF8Name() []byte {
	metric := protowire.AppendTag(nil, 1, protowire.BytesType)
	metric = protowire.AppendBytes(metric, []byte{0xff, 0xfe, 0x00})
	metric = protowire.AppendTag(metric, 2, protowire.VarintType)
	metric = protowire.AppendVarint(metric, 3)

	payload := protowire.AppendTag(nil, 2, protowire.BytesType) // metrics
	payload = protowire.AppendBytes(payload, metric)
	payload = protowire.AppendTag(payload, 3, protowire.VarintType) // seq
	payload = protowire.AppendVarint(payload, 0)
	return payload
}

func TestInvalidUTF8NameIsRepairedAndLaterAliasResolves(t *testing.T) {
	registry := loadTestRegistry(t)
	store := sparkplug.NewSessionStore()
	mw := NewProtoDecodeMiddleware(registry, store)

	// The birth itself must decode: a raw payload here would leave the
	// frontend building the node from a birth it can't parse, with no metrics.
	msg := runMiddleware(t, mw, "spBv1.0/G/NBIRTH/N", wireNBirthInvalidUTF8Name())
	meta := sparkplugMeta(t, msg)
	if meta["msgType"] != "NBIRTH" {
		t.Errorf("expected NBIRTH meta, got %v", meta)
	}
	if (*msg.MiddlewareProperties)["IsDecodedProto"] != true {
		t.Fatal("expected the birth to decode with its bad name repaired")
	}
	want := strings.ToValidUTF8("\xff\xfe\x00", "\uFFFD")
	if names := decodedMetricNames(t, msg.Payload); len(names) != 1 || names[0] != want {
		t.Errorf("expected repaired birth name %q, got %q", want, names)
	}

	// The alias still resolves on a later well-formed message, to the same
	// repaired name.
	data := encodeSparkplugB(t, registry,
		`{"seq":"1","metrics":[{"alias":"3","datatype":10,"doubleValue":239.9}]}`)
	dataMsg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", data)
	dataMeta := sparkplugMeta(t, dataMsg)
	if dataMeta["resolution"] != sparkplug.ResolutionResolved {
		t.Errorf("expected resolved, got %v", dataMeta["resolution"])
	}
	if names := decodedMetricNames(t, dataMsg.Payload); len(names) != 1 || names[0] != want {
		t.Errorf("expected sanitised name %q, got %q", want, names)
	}
}

// wireNDataInvalidUTF8String hand-builds an NDATA (seq=1) whose one metric
// carries an invalid UTF-8 string_value, the same proto2 hole as the bad name
// but in a value.
func wireNDataInvalidUTF8String() []byte {
	metric := protowire.AppendTag(nil, 1, protowire.BytesType) // name
	metric = protowire.AppendBytes(metric, []byte("Label"))
	metric = protowire.AppendTag(metric, 4, protowire.VarintType) // datatype
	metric = protowire.AppendVarint(metric, 12)
	metric = protowire.AppendTag(metric, 15, protowire.BytesType) // string_value
	metric = protowire.AppendBytes(metric, []byte{'o', 'k', 0xc3})

	payload := protowire.AppendTag(nil, 2, protowire.BytesType)
	payload = protowire.AppendBytes(payload, metric)
	payload = protowire.AppendTag(payload, 3, protowire.VarintType)
	payload = protowire.AppendVarint(payload, 1)
	return payload
}

func TestInvalidUTF8StringValueIsRepaired(t *testing.T) {
	registry := loadTestRegistry(t)
	mw := NewProtoDecodeMiddleware(registry, sparkplug.NewSessionStore())

	msg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", wireNDataInvalidUTF8String())
	if (*msg.MiddlewareProperties)["IsDecodedProto"] != true {
		t.Fatal("expected the payload to decode with its bad string repaired")
	}
	var decoded struct {
		Metrics []struct {
			StringValue string `json:"stringValue"`
		} `json:"metrics"`
	}
	if err := json.Unmarshal(msg.Payload, &decoded); err != nil {
		t.Fatalf("payload is not valid JSON: %v", err)
	}
	if len(decoded.Metrics) != 1 || decoded.Metrics[0].StringValue != "ok\uFFFD" {
		t.Errorf("expected repaired string value, got %+v", decoded.Metrics)
	}
}

func decodedMetricNames(t *testing.T, payload []byte) []string {
	t.Helper()
	var decoded struct {
		Metrics []struct {
			Name string `json:"name"`
		} `json:"metrics"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("payload did not marshal to valid JSON: %v", err)
	}
	names := []string{}
	for _, m := range decoded.Metrics {
		names = append(names, m.Name)
	}
	return names
}

func TestNilRegistryLeavesMessageUntouched(t *testing.T) {
	store := sparkplug.NewSessionStore()
	mw := NewProtoDecodeMiddleware(nil, store)

	raw := []byte{0x01, 0x02}
	msg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", raw)
	if string(msg.Payload) != string(raw) {
		t.Errorf("expected raw payload with nil registry, got %v", msg.Payload)
	}
}
