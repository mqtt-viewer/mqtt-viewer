package mqttmiddleware

import (
	"strings"
	"testing"

	topicmatching "mqtt-viewer/backend/topic-matching"
)

func TestProtoEncodeMiddlewareAuto(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{
		enabled:  true,
		match:    topicmatching.ProtoBindingMatch{MessageType: "test.HelloMessage", Source: topicmatching.SourceRule},
		registry: registry,
	}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	original := []byte(`{"bam":"hi"}`)
	params := newTestPublish("greet/hi", original, nil)
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(params.Payload) == string(original) {
		t.Errorf("expected payload to be encoded to protobuf bytes")
	}
}

func TestProtoEncodeMiddlewareAutoNoMatchSkips(t *testing.T) {
	resolver := &fakeResolver{enabled: true, match: topicmatching.ProtoBindingMatch{}}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	original := []byte(`{"bam":"hi"}`)
	params := newTestPublish("no/match", original, nil)
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(params.Payload) != string(original) {
		t.Errorf("expected payload untouched when auto has no match")
	}
}

func TestProtoEncodeMiddlewareAutoEmptyMessageTypeSkips(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{
		enabled:  true,
		match:    topicmatching.ProtoBindingMatch{MessageType: "", Filter: "greet/#", Source: topicmatching.SourceRule},
		registry: registry,
	}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	original := []byte(`{"bam":"hi"}`)
	params := newTestPublish("greet/hi", original, nil)
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(params.Payload) != string(original) {
		t.Errorf("expected payload untouched when the matched rule has no MessageType")
	}
}

func TestProtoEncodeMiddlewareForcedType(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{enabled: true, registry: registry}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	original := []byte(`{"bam":"hi"}`)
	params := newTestPublish("anything", original, strPtr("test.HelloMessage"))
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(params.Payload) == string(original) {
		t.Errorf("expected payload to be encoded to protobuf bytes")
	}
}

func TestProtoEncodeMiddlewareRawOverride(t *testing.T) {
	resolver := &fakeResolver{enabled: true, match: topicmatching.ProtoBindingMatch{MessageType: "test.HelloMessage", Source: topicmatching.SourceRule}}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	original := []byte(`{"bam":"hi"}`)
	params := newTestPublish("greet/hi", original, strPtr(""))
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(params.Payload) != string(original) {
		t.Errorf("expected raw override to skip encoding")
	}
}

func TestProtoEncodeMiddlewareUnknownTypeError(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{enabled: true, registry: registry}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	params := newTestPublish("anything", []byte(`{}`), strPtr("no.Such.Type"))
	err := middleware.Func(params)
	if err == nil {
		t.Fatal("expected an error for an unknown forced type")
	}
	if !strings.Contains(err.Error(), "no.Such.Type") {
		t.Errorf("expected error to name the type, got %v", err)
	}
}

func TestProtoEncodeMiddlewareEncodeFailure(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{enabled: true, registry: registry}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	params := newTestPublish("anything", []byte(`not json`), strPtr("test.HelloMessage"))
	err := middleware.Func(params)
	if err == nil {
		t.Fatal("expected an encode error for an invalid JSON payload")
	}
	if !strings.Contains(err.Error(), "test.HelloMessage") {
		t.Errorf("expected error to name the type, got %v", err)
	}
	if !strings.Contains(err.Error(), "protobuf encode as") {
		t.Errorf("expected error to follow the documented format, got %v", err)
	}
}

func TestProtoEncodeMiddlewareEmptyPayloadSkip(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{
		enabled:  true,
		match:    topicmatching.ProtoBindingMatch{MessageType: "test.HelloMessage", Source: topicmatching.SourceRule},
		registry: registry,
	}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	params := newTestPublish("greet/hi", []byte{}, nil)
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(params.Payload) != 0 {
		t.Errorf("expected zero-length payload to stay untouched")
	}
}

func TestProtoEncodeMiddlewareAutoSparkplugUnloadedPassthrough(t *testing.T) {
	resolver := &fakeResolver{
		enabled: true,
		match:   topicmatching.ProtoBindingMatch{MessageType: "SparkplugBPayload", Source: topicmatching.SourceSparkplug},
	}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	original := []byte(`{"seq":"1"}`)
	params := newTestPublish("spBv1.0/group/NDATA/node", original, nil)
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(params.Payload) != string(original) {
		t.Errorf("expected raw pass-through when sparkplug registry isn't loaded yet")
	}
}

func TestProtoEncodeMiddlewareForcedOverrideFallsBackToSparkplugRegistry(t *testing.T) {
	sparkplugRegistry := loadSparkplugRegistry(t)
	resolver := &fakeResolver{enabled: true}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(sparkplugRegistry))

	original := []byte(`{"seq":"1"}`)
	params := newTestPublish("anything", original, strPtr("SparkplugBPayload"))
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(params.Payload) == string(original) {
		t.Errorf("expected payload to be encoded via the sparkplug registry fallback")
	}
}

func TestProtoEncodeMiddlewareDisabledPassthrough(t *testing.T) {
	registry := loadGoodRegistry(t)
	resolver := &fakeResolver{enabled: false, registry: registry}
	middleware := NewProtoEncodeMiddleware(resolver, sparkplugRegistryFunc(nil))

	original := []byte(`{"bam":"hi"}`)
	params := newTestPublish("greet/hi", original, strPtr("test.HelloMessage"))
	if err := middleware.Func(params); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(params.Payload) != string(original) {
		t.Errorf("expected payload untouched while disabled")
	}
}
