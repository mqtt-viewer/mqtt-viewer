package mqttmiddleware

import (
	"encoding/json"
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	"mqtt-viewer/backend/sparkplug"
	topicmatching "mqtt-viewer/backend/topic-matching"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/reflect/protoreflect"
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
	mw := newSparkplugDecode(nil, nil)
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
	mw := newSparkplugDecode(registry, store)

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
	mw := newSparkplugDecode(registry, store)

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
	mw := newSparkplugDecode(registry, store)

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
	mw := newSparkplugDecode(registry, store)

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
	mw := newSparkplugDecode(registry, nil)

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
	mw := newSparkplugDecode(registry, store)

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
	mw := newSparkplugDecode(registry, sparkplug.NewSessionStore())

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
	mw := newSparkplugDecode(nil, store)

	raw := []byte{0x01, 0x02}
	msg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", raw)
	if string(msg.Payload) != string(raw) {
		t.Errorf("expected raw payload with nil registry, got %v", msg.Payload)
	}
}

func TestStatefulDecodeFlagsAPayloadThatIsNotSparkplug(t *testing.T) {
	registry := loadTestRegistry(t)
	mw := newSparkplugDecode(registry, sparkplug.NewSessionStore())
	msg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", []byte(`{"temp": 21.5}`))
	if msg.MiddlewareProperties == nil || (*msg.MiddlewareProperties)["ProtoDecodeFailed"] != true {
		t.Fatalf("expected the failed decode flagged, got %v", msg.MiddlewareProperties)
	}
	if string(msg.Payload) != `{"temp": 21.5}` {
		t.Errorf("expected the payload left as it was, got %s", msg.Payload)
	}
}

// spBv1.0 topics outside the strict grammar take the stateless decode, and a
// payload it can't read is flagged the same way.
func TestStatelessDecodeFlagsAPayloadThatIsNotSparkplug(t *testing.T) {
	registry := loadTestRegistry(t)
	mw := newSparkplugDecode(registry, sparkplug.NewSessionStore())
	for _, topic := range []string{"spBv1.0/G/NDATA/N/", "spBv1.0/G/NDATA/N/x/y", "spBv1.0/G/NDATA"} {
		msg := runMiddleware(t, mw, topic, []byte(`{"temp": 21.5}`))
		if msg.MiddlewareProperties == nil || (*msg.MiddlewareProperties)["ProtoDecodeFailed"] != true {
			t.Errorf("%s: expected the failed decode flagged, got %v", topic, msg.MiddlewareProperties)
		}
	}
}

func TestProtoDecodeMiddlewareOk(t *testing.T) {
	registry := loadGoodRegistry(t)
	descriptor, ok := registry.GetMessageDescriptorFromName("test.HelloMessage")
	if !ok {
		t.Fatalf("expected test.HelloMessage in the fixture registry")
	}
	payload, err := protobuf.EncodeFromJSONBytes([]byte(`{"bam":"hi","whambam":"there"}`), descriptor)
	if err != nil {
		t.Fatalf("encoding fixture payload: %v", err)
	}

	resolver := &fakeResolver{
		enabled:  true,
		match:    topicmatching.ProtoBindingMatch{MessageType: "test.HelloMessage", Filter: "greet/#", Source: topicmatching.SourceRule},
		registry: registry,
	}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil), nil)

	msg := newTestMessage("greet/hi", payload)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	props := *msg.MiddlewareProperties
	if props["IsDecodedProto"] != true {
		t.Errorf("expected IsDecodedProto=true, got %v", props["IsDecodedProto"])
	}
	if props["ProtoDescriptorName"] != "test.HelloMessage" {
		t.Errorf("expected descriptor name test.HelloMessage, got %v", props["ProtoDescriptorName"])
	}
	if _, ok := props["ProtoDecodeFailed"]; ok {
		t.Errorf("expected no failed flag on a successful decode")
	}
	if string(msg.Payload) == string(payload) {
		t.Errorf("expected payload to be replaced with decoded JSON")
	}
}

func TestProtoDecodeMiddlewareFailedMarker(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{
		enabled:  true,
		match:    topicmatching.ProtoBindingMatch{MessageType: "test.HelloMessage", Source: topicmatching.SourceRule},
		registry: registry,
	}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil), nil)

	// A truncated varint guarantees an unmarshal error regardless of which
	// field number it lands on.
	original := []byte{0x80}
	msg := newTestMessage("greet/hi", original)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error (decode failures are never fatal), got %v", err)
	}

	props := *msg.MiddlewareProperties
	if props["ProtoDecodeFailed"] != true {
		t.Errorf("expected ProtoDecodeFailed=true, got %v", props["ProtoDecodeFailed"])
	}
	if props["ProtoDescriptorName"] != "test.HelloMessage" {
		t.Errorf("expected descriptor name recorded, got %v", props["ProtoDescriptorName"])
	}
	if _, ok := props["IsDecodedProto"]; ok {
		t.Errorf("expected no IsDecodedProto on a decode failure")
	}
	if string(msg.Payload) != string(original) {
		t.Errorf("expected payload untouched on decode failure")
	}
}

func TestProtoDecodeMiddlewareStaleTypeFailedMarker(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{
		enabled:  true,
		match:    topicmatching.ProtoBindingMatch{MessageType: "not.Registered", Source: topicmatching.SourceRule},
		registry: registry,
	}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil), nil)

	original := []byte("raw bytes")
	msg := newTestMessage("x", original)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	props := *msg.MiddlewareProperties
	if props["ProtoDecodeFailed"] != true {
		t.Errorf("expected ProtoDecodeFailed=true for a stale/unregistered type, got %v", props["ProtoDecodeFailed"])
	}
	if props["ProtoDescriptorName"] != "not.Registered" {
		t.Errorf("expected descriptor name recorded, got %v", props["ProtoDescriptorName"])
	}
	if string(msg.Payload) != string(original) {
		t.Errorf("expected payload untouched")
	}
}

func TestProtoDecodeMiddlewareNoMatchUntouched(t *testing.T) {
	resolver := &fakeResolver{enabled: true, match: topicmatching.ProtoBindingMatch{}}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil), nil)

	original := []byte("raw bytes")
	msg := newTestMessage("x", original)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(*msg.MiddlewareProperties) != 0 {
		t.Errorf("expected no middleware properties set on no match, got %v", *msg.MiddlewareProperties)
	}
	if string(msg.Payload) != string(original) {
		t.Errorf("expected payload untouched")
	}
}

func TestProtoDecodeMiddlewareEmptyMessageTypeUntouched(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{
		enabled:  true,
		match:    topicmatching.ProtoBindingMatch{MessageType: "", Filter: "greet/#", Source: topicmatching.SourceRule},
		registry: registry,
	}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil), nil)

	original := []byte("raw bytes")
	msg := newTestMessage("greet/hi", original)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(*msg.MiddlewareProperties) != 0 {
		t.Errorf("expected no middleware properties set for a matched rule with no MessageType, got %v", *msg.MiddlewareProperties)
	}
	if string(msg.Payload) != string(original) {
		t.Errorf("expected payload untouched")
	}
}

func TestProtoDecodeMiddlewareSparkplugFallbackOk(t *testing.T) {
	sparkplugRegistry := loadSparkplugRegistry(t)
	descriptor, ok := sparkplugRegistry.GetMessageDescriptorFromName("SparkplugBPayload")
	if !ok {
		t.Fatalf("expected SparkplugBPayload in the sparkplug registry")
	}
	payload, err := protobuf.EncodeFromJSONBytes([]byte(`{"seq":"1"}`), descriptor)
	if err != nil {
		t.Fatalf("encoding fixture payload: %v", err)
	}

	resolver := &fakeResolver{
		enabled: true,
		match:   topicmatching.ProtoBindingMatch{MessageType: "SparkplugBPayload", Filter: "spBv1.0/#", Source: topicmatching.SourceSparkplug},
	}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(sparkplugRegistry), nil)

	msg := newTestMessage("spBv1.0/group/NDATA/node", payload)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	props := *msg.MiddlewareProperties
	if props["IsDecodedProto"] != true {
		t.Errorf("expected sparkplug decode ok, got %v", props)
	}
	if _, named := props["ProtoDescriptorName"]; named {
		t.Errorf("expected no descriptor name on a Sparkplug decode, got %v", props["ProtoDescriptorName"])
	}
}

func TestProtoDecodeMiddlewareSparkplugRegistryNotLoadedPassthrough(t *testing.T) {
	resolver := &fakeResolver{
		enabled: true,
		match:   topicmatching.ProtoBindingMatch{MessageType: "SparkplugBPayload", Source: topicmatching.SourceSparkplug},
	}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil), nil)

	original := []byte("raw")
	msg := newTestMessage("spBv1.0/g/NDATA/n", original)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(*msg.MiddlewareProperties) != 0 {
		t.Errorf("expected pass-through (no properties set) when the global sparkplug registry isn't loaded yet, got %v", *msg.MiddlewareProperties)
	}
	if string(msg.Payload) != string(original) {
		t.Errorf("expected payload untouched")
	}
}

func TestProtoDecodeMiddlewareDisabledPassthrough(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{
		enabled:  false,
		match:    topicmatching.ProtoBindingMatch{MessageType: "test.HelloMessage", Source: topicmatching.SourceRule},
		registry: registry,
	}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil), nil)

	original := []byte("raw")
	msg := newTestMessage("greet/hi", original)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(*msg.MiddlewareProperties) != 0 {
		t.Errorf("expected no middleware properties set while disabled")
	}
	if string(msg.Payload) != string(original) {
		t.Errorf("expected payload untouched while disabled")
	}
}

// matcherResolver is an enabled resolver over a real binding matcher, so
// precedence between rules and the implicit Sparkplug rules is exercised.
type matcherResolver struct {
	matcher  *topicmatching.ProtoBindingMatcher
	registry *protobuf.ProtoRegistry
}

func (m *matcherResolver) IsEnabled() bool { return true }

func (m *matcherResolver) Match(topic string) topicmatching.ProtoBindingMatch {
	return m.matcher.Match(topic)
}

func (m *matcherResolver) RuleDescriptor(name string) (protoreflect.MessageDescriptor, bool) {
	return m.registry.GetMessageDescriptorFromName(name)
}

// A wildcard-first binding must not take Sparkplug traffic away from the
// stateful decode: not a catch-all #, and not +/G/# or +/+/NDATA/+ either,
// which have more literal segments than spBv1.0/#. Legacy STATE/<host>
// topics, which no implicit rule covers, are guarded the same way.
func TestCatchAllRuleKeepsSparkplugStateful(t *testing.T) {
	sparkplugRegistry := loadTestRegistry(t)
	store := sparkplug.NewSessionStore()
	resolver := &matcherResolver{
		matcher: topicmatching.NewProtoBindingMatcher([]models.ProtoBindingRule{
			{ID: 1, TopicFilter: "#", MessageType: "test.HelloMessage"},
			{ID: 2, TopicFilter: "+/G/#", MessageType: "test.HelloMessage"},
			{ID: 3, TopicFilter: "+/+/NDATA/+", MessageType: "test.HelloMessage"},
			{ID: 4, TopicFilter: "+/scada-primary", MessageType: "test.HelloMessage"},
		}),
		registry: loadGoodRegistry(t),
	}
	mw := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(sparkplugRegistry), store)

	birth := encodeSparkplugB(t, sparkplugRegistry,
		`{"seq":"0","metrics":[{"name":"Volts/L1","alias":"3","datatype":10,"doubleValue":240.1}]}`)
	msg := runMiddleware(t, mw, "spBv1.0/G/NBIRTH/N", birth)
	if meta := sparkplugMeta(t, msg); meta["msgType"] != "NBIRTH" {
		t.Errorf("expected NBIRTH meta, got %v", meta)
	}
	if _, named := (*msg.MiddlewareProperties)[PropProtoDescriptorName]; named {
		t.Errorf("expected a Sparkplug decode, not a binding's, got %v", *msg.MiddlewareProperties)
	}

	data := encodeSparkplugB(t, sparkplugRegistry,
		`{"seq":"1","metrics":[{"alias":"3","datatype":10,"doubleValue":240.2}]}`)
	dataMsg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", data)
	if meta := sparkplugMeta(t, dataMsg); meta["msgType"] != "NDATA" {
		t.Errorf("expected NDATA meta, got %v", meta)
	}
	if _, named := (*dataMsg.MiddlewareProperties)[PropProtoDescriptorName]; named {
		t.Errorf("expected +/+/NDATA/+ not to outrank spBv1.0/#, got %v", *dataMsg.MiddlewareProperties)
	}

	legacy := runMiddleware(t, mw, "STATE/scada-primary", []byte("ONLINE"))
	if meta := sparkplugMeta(t, legacy); meta["hostId"] != "scada-primary" {
		t.Errorf("unexpected legacy STATE meta: %v", meta)
	}
	if _, failed := (*legacy.MiddlewareProperties)[PropProtoDecodeFailed]; failed {
		t.Error("expected the catch-all rule not to claim a STATE topic")
	}

	other := runMiddleware(t, mw, "sensors/1", []byte("not protobuf at all"))
	if (*other.MiddlewareProperties)[PropProtoDecodeFailed] != true {
		t.Errorf("expected the catch-all rule to claim an ordinary topic, got %v", *other.MiddlewareProperties)
	}
}

// A rule more specific than spBv1.0/# wins, and a payload that doesn't fit
// its type is flagged failed with the rule's type name.
func TestSpecificRuleBeatsImplicitSparkplug(t *testing.T) {
	sparkplugRegistry := loadTestRegistry(t)
	resolver := &matcherResolver{
		matcher: topicmatching.NewProtoBindingMatcher([]models.ProtoBindingRule{
			{ID: 1, TopicFilter: "spBv1.0/G/NDATA/+", MessageType: "test.HelloMessage"},
		}),
		registry: loadGoodRegistry(t),
	}
	mw := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(sparkplugRegistry), sparkplug.NewSessionStore())

	msg := runMiddleware(t, mw, "spBv1.0/G/NDATA/N", []byte{0x80})
	props := *msg.MiddlewareProperties
	if props[PropProtoDecodeFailed] != true || props[PropProtoDescriptorName] != "test.HelloMessage" {
		t.Errorf("expected a failed decode as test.HelloMessage, got %v", props)
	}
	if _, ok := props["sparkplug"]; ok {
		t.Error("expected no Sparkplug meta on a topic a rule claimed")
	}
}

// A rule that names a legacy STATE topic explicitly claims it on receive,
// matching what the topic tester and publish report.
func TestExplicitStateRuleClaimsLegacyState(t *testing.T) {
	sparkplugRegistry := loadTestRegistry(t)
	resolver := &matcherResolver{
		matcher: topicmatching.NewProtoBindingMatcher([]models.ProtoBindingRule{
			{ID: 1, TopicFilter: "STATE/pump1", MessageType: "test.HelloMessage"},
		}),
		registry: loadGoodRegistry(t),
	}
	mw := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(sparkplugRegistry), sparkplug.NewSessionStore())

	msg := runMiddleware(t, mw, "STATE/pump1", []byte("ONLINE"))
	props := *msg.MiddlewareProperties
	if props[PropProtoDescriptorName] != "test.HelloMessage" {
		t.Errorf("expected the STATE rule to claim the topic, got %v", props)
	}
	if _, ok := props["sparkplug"]; ok {
		t.Error("expected no Sparkplug meta on a topic a rule claimed")
	}
}
