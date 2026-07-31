package mqttmiddleware

import (
	"path"
	"path/filepath"
	"runtime"
	"testing"

	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"

	"google.golang.org/protobuf/reflect/protoreflect"
)

var _, thisTestFile, _, _ = runtime.Caller(0)
var thisTestDir = filepath.Dir(thisTestFile)

// loadGoodRegistry compiles backend/protobuf's shared "good" fixture
// (package test: HelloMessage, TestMessageWithVeryLongNameJustToSeeWhatHappens;
// package complex/demo: more) for use as a per-connection registry stand-in.
func loadGoodRegistry(t *testing.T) *protobuf.ProtoRegistry {
	t.Helper()
	registry, err := protobuf.LoadProtoRegistry(path.Join(thisTestDir, "../protobuf/test-protos/test-protos-good"))
	if err != nil {
		t.Fatalf("loading test-protos-good registry: %v", err)
	}
	return registry
}

// loadSparkplugRegistry compiles the real embedded sparkplug A/B protos, for
// the sparkplug-fallback middleware tests.
func loadSparkplugRegistry(t *testing.T) *protobuf.ProtoRegistry {
	t.Helper()
	dir := t.TempDir()
	if err := protobuf.WriteSparkplugProtoFiles(dir); err != nil {
		t.Fatalf("writing sparkplug proto files: %v", err)
	}
	registry, err := protobuf.LoadProtoRegistry(path.Join(dir, protobuf.ProtoResourceDirName))
	if err != nil {
		t.Fatalf("loading sparkplug registry: %v", err)
	}
	return registry
}

// fakeResolver is a minimal ProtoResolver stand-in for protoState, so the
// middleware tests don't need a live App/AppConnection.
type fakeResolver struct {
	enabled  bool
	match    topicmatching.ProtoBindingMatch
	registry *protobuf.ProtoRegistry
}

func (f *fakeResolver) IsEnabled() bool { return f.enabled }

func (f *fakeResolver) Match(topic string) topicmatching.ProtoBindingMatch {
	return f.match
}

func (f *fakeResolver) RuleDescriptor(name string) (protoreflect.MessageDescriptor, bool) {
	if f.registry == nil {
		return nil, false
	}
	return f.registry.GetMessageDescriptorFromName(name)
}

func sparkplugRegistryFunc(reg *protobuf.ProtoRegistry) SparkplugRegistryFunc {
	return func() *protobuf.ProtoRegistry { return reg }
}

func newTestMessage(topic string, payload []byte) *mqtt.MqttMessage {
	return &mqtt.MqttMessage{
		Topic:                topic,
		Payload:              payload,
		MiddlewareProperties: &map[string]any{},
	}
}

func newTestPublish(topic string, payload []byte, override *string) *mqtt.MqttPublishParams {
	return &mqtt.MqttPublishParams{Topic: topic, Payload: payload, ProtoOverride: override}
}

func strPtr(s string) *string { return &s }
