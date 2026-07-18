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

// NewProtoDecodeMiddleware decodes Sparkplug payloads before they enter
// history. When a session store is provided, topics matching the strict
// Sparkplug B grammar take the stateful path: birth/alias tracking, metric
// name injection into the stored payload, and a per-message "sparkplug" meta
// map in middleware properties. Everything else (spAv1.0, and spBv1.0 topics
// that fail the strict grammar) keeps the original stateless decode. A nil
// store disables the stateful path entirely.
func NewProtoDecodeMiddleware(protoRegistry *protobuf.ProtoRegistry, sparkplugStore *sparkplug.SessionStore) *ProtoDecodeMiddleware {
	return &ProtoDecodeMiddleware{
		Middleware: mqtt.Middleware[mqtt.MqttMessage]{
			ID: PROTO_DECODE_MIDDLEWARE_ID,
			Func: func(params *mqtt.MqttMessage) error {
				if sparkplugStore != nil {
					if info, ok := sparkplug.ParseTopic(params.Topic); ok {
						return decodeStateful(protoRegistry, sparkplugStore, params, info)
					}
				}
				return decodeStateless(protoRegistry, params)
			},
		},
	}
}

func decodeStateful(protoRegistry *protobuf.ProtoRegistry, store *sparkplug.SessionStore, params *mqtt.MqttMessage, info sparkplug.TopicInfo) error {
	if info.Type == sparkplug.MessageTypeState {
		// STATE payloads are JSON (3.0) or plain text (legacy 2.2), never
		// protobuf — attach meta and leave the payload untouched.
		meta := store.HandleMessage(info, nil, params.Time)
		setMiddlewareProperty(params, "sparkplug", meta)
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

	msg, err := protobuf.UnmarshalToDynamic(params.Payload, descriptor)
	if err != nil {
		// Don't error - just use payload as normal
		slog.Debug(fmt.Sprintf("sparkplug decode middleware error: %s", err.Error()))
		return nil
	}
	meta := store.HandleMessage(info, msg, params.Time)
	decodedPayload, err := protobuf.MarshalDynamicToJSON(msg)
	if err != nil {
		// Alias/seq state is already committed above. Keep the sparkplug
		// meta so tree tracking doesn't go dark even though this payload
		// can't be shown decoded — e.g. a metric name with invalid UTF-8,
		// which proto2 lets through Unmarshal but protojson.Marshal rejects.
		slog.Debug(fmt.Sprintf("sparkplug decode middleware error: %s", err.Error()))
		setMiddlewareProperty(params, "sparkplug", meta)
		return nil
	}
	params.Payload = decodedPayload
	setMiddlewareProperty(params, "IsDecodedProto", true)
	setMiddlewareProperty(params, "sparkplug", meta)
	return nil
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
		return nil
	}
	if decodedPayload == nil {
		return nil
	}
	// Indicates that the payload has been decoded
	// so that the front end can display a marker
	setMiddlewareProperty(params, "IsDecodedProto", true)
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
