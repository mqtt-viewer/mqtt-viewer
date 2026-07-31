package mqttmiddleware

import (
	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"

	"google.golang.org/protobuf/reflect/protoreflect"
)

// ProtoResolver is the per-connection seam the proto middlewares read
// through: whether decode/encode is switched on, the live topic-to-type
// matcher (including sparkplug's implicit rules), and per-connection
// registry lookups for rule-sourced matches. backend/app's protoState
// implements this.
type ProtoResolver interface {
	IsEnabled() bool
	Match(topic string) topicmatching.ProtoBindingMatch
	RuleDescriptor(name string) (protoreflect.MessageDescriptor, bool)
}

// SparkplugRegistryFunc resolves the global sparkplug proto registry at call
// time (it may not have finished compiling yet if a connection comes up
// fast at startup).
type SparkplugRegistryFunc func() *protobuf.ProtoRegistry

// resolveDescriptor looks up the descriptor for a matched type name, routing
// to the global sparkplug registry or the per-connection rule registry
// depending on source.
func resolveDescriptor(resolver ProtoResolver, sparkplugRegistry SparkplugRegistryFunc, source string, typeName string) (protoreflect.MessageDescriptor, bool) {
	if source == topicmatching.SourceSparkplug {
		registry := sparkplugRegistry()
		if registry == nil {
			return nil, false
		}
		return registry.GetMessageDescriptorFromName(typeName)
	}
	return resolver.RuleDescriptor(typeName)
}
