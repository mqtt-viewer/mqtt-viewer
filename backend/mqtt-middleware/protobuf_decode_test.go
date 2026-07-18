package mqttmiddleware

import (
	"testing"

	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"
)

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
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	msg := newTestMessage("greet/hi", payload)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	props := *msg.MiddlewareProperties
	if props["ProtoDecode"] != "ok" {
		t.Errorf("expected ProtoDecode=ok, got %v", props["ProtoDecode"])
	}
	if props["ProtoDescriptorName"] != "test.HelloMessage" {
		t.Errorf("expected descriptor name test.HelloMessage, got %v", props["ProtoDescriptorName"])
	}
	if props["IsDecodedProto"] != true {
		t.Errorf("expected legacy IsDecodedProto=true, got %v", props["IsDecodedProto"])
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
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	// A truncated varint guarantees an unmarshal error regardless of which
	// field number it lands on.
	original := []byte{0x80}
	msg := newTestMessage("greet/hi", original)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error (decode failures are never fatal), got %v", err)
	}

	props := *msg.MiddlewareProperties
	if props["ProtoDecode"] != "failed" {
		t.Errorf("expected ProtoDecode=failed, got %v", props["ProtoDecode"])
	}
	if props["ProtoDescriptorName"] != "test.HelloMessage" {
		t.Errorf("expected descriptor name recorded, got %v", props["ProtoDescriptorName"])
	}
	if _, ok := props["IsDecodedProto"]; ok {
		t.Errorf("expected no legacy flag on a decode failure")
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
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	original := []byte("raw bytes")
	msg := newTestMessage("x", original)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	props := *msg.MiddlewareProperties
	if props["ProtoDecode"] != "failed" {
		t.Errorf("expected ProtoDecode=failed for a stale/unregistered type, got %v", props["ProtoDecode"])
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
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil))

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
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil))

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
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(sparkplugRegistry))

	msg := newTestMessage("spBv1.0/group/NDATA/node", payload)
	if err := middleware.Func(msg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	props := *msg.MiddlewareProperties
	if props["ProtoDecode"] != "ok" {
		t.Errorf("expected sparkplug decode ok, got %v", props["ProtoDecode"])
	}
	if props["ProtoDescriptorName"] != "SparkplugBPayload" {
		t.Errorf("expected descriptor name SparkplugBPayload, got %v", props["ProtoDescriptorName"])
	}
}

func TestProtoDecodeMiddlewareSparkplugRegistryNotLoadedPassthrough(t *testing.T) {
	resolver := &fakeResolver{
		enabled: true,
		match:   topicmatching.ProtoBindingMatch{MessageType: "SparkplugBPayload", Source: topicmatching.SourceSparkplug},
	}
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil))

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
	middleware := NewProtoDecodeMiddleware(resolver, sparkplugRegistryFunc(nil))

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
