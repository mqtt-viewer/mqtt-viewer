package mqttmiddleware

import (
	"fmt"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	"mqtt-viewer/backend/sparkplug"
	topicmatching "mqtt-viewer/backend/topic-matching"

	"golang.org/x/exp/slog"
	"google.golang.org/protobuf/reflect/protoreflect"
)

type ProtoDecodeMiddleware struct {
	mqtt.Middleware[mqtt.MqttMessage]
}

var PROTO_DECODE_MIDDLEWARE_ID = "ProtoDecodeMiddleware"

// Middleware property keys the decode middleware sets. One decode-state
// model for every source (Sparkplug and per-topic binding rules), persisted
// as received_messages.decode_state (decoded, failed or raw):
//   - PropIsDecodedProto: Payload is the decoded JSON, not the wire bytes.
//   - PropProtoDecodeFailed: a decode was attempted and failed; raw bytes.
//   - PropProtoDescriptorName: the message type a binding rule's decode used
//     or tried. Sparkplug decodes leave it unset to keep that hot path as
//     lean as it was. Live only, not persisted with recorded messages.
const (
	PropIsDecodedProto      = "IsDecodedProto"
	PropProtoDecodeFailed   = "ProtoDecodeFailed"
	PropProtoDescriptorName = "ProtoDescriptorName"
)

// NewProtoDecodeMiddleware decodes an incoming message's payload to JSON
// before it enters history. It does nothing while the resolver is disabled.
//
// A topic claimed by a per-topic binding rule decodes as the rule's message
// type from the connection's imported registry. A failure there (bad bytes,
// a payload that matched none of the type's fields, or a type that isn't in
// the loaded files) leaves the payload untouched and flags it failed with the
// type name, so the UI can say so.
//
// Every other topic keeps the Sparkplug behaviour: when a session store is
// provided, topics matching the strict Sparkplug B grammar take the stateful
// path (birth/alias tracking, metric name injection into the stored payload,
// and a per-message "sparkplug" meta map in middleware properties); anything
// else (spAv1.0, and spBv1.0 topics that fail the strict grammar) keeps the
// stateless decode. A nil store disables the stateful path. The matcher
// keeps wildcard-first rules (a catch-all "#", "+/G/#") off Sparkplug
// namespaces and legacy STATE/<host> topics, so those only leave the
// Sparkplug path for a rule that names them explicitly.
func NewProtoDecodeMiddleware(resolver ProtoResolver, sparkplugRegistry SparkplugRegistryFunc, sparkplugStore *sparkplug.SessionStore) *ProtoDecodeMiddleware {
	return &ProtoDecodeMiddleware{
		Middleware: mqtt.Middleware[mqtt.MqttMessage]{
			ID: PROTO_DECODE_MIDDLEWARE_ID,
			Func: func(params *mqtt.MqttMessage) error {
				if !resolver.IsEnabled() {
					return nil
				}
				match := resolver.Match(params.Topic)
				// A typeless rule is a no-op binding, never a match.
				if match.Source == topicmatching.SourceRule && match.MessageType != "" {
					return decodeRule(resolver, params, match.MessageType)
				}
				var info sparkplug.TopicInfo
				isSparkplugGrammar := false
				if sparkplugStore != nil {
					info, isSparkplugGrammar = sparkplug.ParseTopic(params.Topic)
				}
				registry := sparkplugRegistry()
				if isSparkplugGrammar {
					return decodeStateful(registry, sparkplugStore, params, info)
				}
				return decodeStateless(registry, params)
			},
		},
	}
}

// decodeRule decodes a message claimed by a per-topic binding rule.
func decodeRule(resolver ProtoResolver, params *mqtt.MqttMessage, typeName string) error {
	descriptor, ok := resolver.RuleDescriptor(typeName)
	if !ok {
		setDecodeFailed(params, typeName)
		return nil
	}
	decodedPayload, err := protobuf.DecodeFromProtoBytesStrict(params.Payload, descriptor)
	if err != nil {
		slog.Debug(fmt.Sprintf("proto decode middleware: %s", err.Error()))
		setDecodeFailed(params, typeName)
		return nil
	}
	params.Payload = decodedPayload
	setDecoded(params, typeName)
	return nil
}

// setDecoded and setDecodeFailed record the outcome; typeName is empty for
// Sparkplug decodes.
func setDecoded(params *mqtt.MqttMessage, typeName string) {
	setMiddlewareProperty(params, PropIsDecodedProto, true)
	if typeName != "" {
		setMiddlewareProperty(params, PropProtoDescriptorName, typeName)
	}
}

func setDecodeFailed(params *mqtt.MqttMessage, typeName string) {
	setMiddlewareProperty(params, PropProtoDecodeFailed, true)
	if typeName != "" {
		setMiddlewareProperty(params, PropProtoDescriptorName, typeName)
	}
}

func decodeStateful(protoRegistry *protobuf.ProtoRegistry, store *sparkplug.SessionStore, params *mqtt.MqttMessage, info sparkplug.TopicInfo) error {
	if info.Type == sparkplug.MessageTypeState {
		// STATE payloads are JSON (3.0) or plain text (legacy 2.2), never
		// protobuf — attach meta and leave the payload untouched.
		setSparkplugMeta(params, store.HandleMessage(info, nil, messageRef(params)))
		return nil
	}

	// The registry loads async at startup and may not be ready yet.
	if protoRegistry == nil {
		return nil
	}
	descriptor, ok := protoRegistry.GetMessageDescriptorFromName("SparkplugBPayload")
	if !ok {
		return nil
	}

	// Sparkplug B has no required fields, so skip the check for them.
	msg, err := protobuf.UnmarshalWithoutRequiredCheck(params.Payload, descriptor)
	if err != nil {
		// Don't error - just use payload as normal. Flag it, so the payload
		// view can say this isn't Sparkplug B rather than suggest turning
		// on decoding that is already on.
		slog.Debug(fmt.Sprintf("sparkplug decode middleware error: %s", err.Error()))
		setDecodeFailed(params, "")
		return nil
	}
	meta := store.HandleMessage(info, msg, messageRef(params))
	decodedPayload, err := protobuf.MarshalDynamicToJSON(msg)
	if err != nil {
		// Alias/seq state is already committed above. Keep the sparkplug
		// meta so tree tracking doesn't go dark even though this payload
		// can't be shown decoded. MarshalDynamicToJSON already repairs
		// invalid UTF-8, so this is a genuinely unrenderable payload.
		slog.Debug(fmt.Sprintf("sparkplug decode middleware error: %s", err.Error()))
		setSparkplugMeta(params, meta)
		return nil
	}
	params.Payload = decodedPayload
	setDecoded(params, "")
	setSparkplugMeta(params, meta)
	return nil
}

func messageRef(params *mqtt.MqttMessage) sparkplug.MessageRef {
	return sparkplug.MessageRef{Topic: params.Topic, ID: params.Id, TimeMs: params.TimeMs, Retained: params.Retain}
}

// setSparkplugMeta attaches the session store's meta, skipping it entirely when
// the store declined to track the message (a node past the tracking cap). The
// payload still decodes; it just carries no Sparkplug meta, so the frontend
// doesn't allocate tree state for a node we can't follow.
func setSparkplugMeta(params *mqtt.MqttMessage, meta map[string]any) {
	if meta == nil {
		return
	}
	setMiddlewareProperty(params, "sparkplug", meta)
}

func decodeStateless(protoRegistry *protobuf.ProtoRegistry, params *mqtt.MqttMessage) error {
	if protoRegistry == nil {
		return nil
	}
	var descriptor *protoreflect.MessageDescriptor
	if topicmatching.MatchesSparkplugAPrefix(params.Topic) {
		sparkplugADescriptor, ok := protoRegistry.GetMessageDescriptorFromName("SparkplugAPayload")
		if ok {
			descriptor = &sparkplugADescriptor
		}
	}

	if topicmatching.MatchesSparkplugBPrefix(params.Topic) {
		sparkplugBDescriptor, ok := protoRegistry.GetMessageDescriptorFromName("SparkplugBPayload")
		if ok {
			descriptor = &sparkplugBDescriptor
		}
	}

	if descriptor == nil {
		// No need to decode
		return nil
	}

	decodedPayload, err := protobuf.DecodeFromProtoBytes(params.Payload, *descriptor)
	if err != nil {
		// Don't error - just use payload as normal
		slog.Debug(fmt.Sprintf("proto decode middleware error: %s", err.Error()))
		if topicmatching.MatchesSparkplugBPrefix(params.Topic) {
			setDecodeFailed(params, "")
		}
		return nil
	}
	if decodedPayload == nil {
		return nil
	}
	// Indicates that the payload has been decoded
	// so that the front end can display a marker
	setDecoded(params, "")
	params.Payload = decodedPayload
	return nil
}

// setMiddlewareProperty guards against a nil properties map (v3 messages
// historically arrived without one).
func setMiddlewareProperty(params *mqtt.MqttMessage, key string, value any) {
	if params.MiddlewareProperties == nil {
		props := map[string]any{}
		params.MiddlewareProperties = &props
	}
	(*params.MiddlewareProperties)[key] = value
}
