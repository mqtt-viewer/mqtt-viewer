package mqttmiddleware

import (
	"fmt"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"

	"golang.org/x/exp/slog"
)

type ProtoDecodeMiddleware struct {
	mqtt.Middleware[mqtt.MqttMessage]
}

var PROTO_DECODE_MIDDLEWARE_ID = "ProtoDecodeMiddleware"

// NewProtoDecodeMiddleware decodes an incoming message's payload to JSON when
// its topic matches a binding rule or an implicit sparkplug rule. It never
// errors: a decode failure or a stale/unloaded descriptor leaves the payload
// untouched and marks it via MiddlewareProperties for the frontend, except a
// sparkplug match with no loaded global registry yet, which passes through
// silently (matches pre-binding behaviour). A rule match with no MessageType
// set is a no-op binding (the user hasn't picked a type yet) and is treated
// as no match at all: passthrough, no failed marker.
func NewProtoDecodeMiddleware(resolver ProtoResolver, sparkplugRegistry SparkplugRegistryFunc) *ProtoDecodeMiddleware {
	return &ProtoDecodeMiddleware{
		Middleware: mqtt.Middleware[mqtt.MqttMessage]{
			ID: PROTO_DECODE_MIDDLEWARE_ID,
			Func: func(params *mqtt.MqttMessage) error {
				if !resolver.IsEnabled() {
					return nil
				}

				match := resolver.Match(params.Topic)
				if match.Source == "" || match.MessageType == "" {
					return nil
				}

				descriptor, ok := resolveDescriptor(resolver, sparkplugRegistry, match.Source, match.MessageType)
				if !ok {
					if match.Source == topicmatching.SourceSparkplug {
						// Global sparkplug registry not loaded yet: pass through
						// silently, matching today's behaviour.
						return nil
					}
					(*params.MiddlewareProperties)["ProtoDecode"] = "failed"
					(*params.MiddlewareProperties)["ProtoDescriptorName"] = match.MessageType
					return nil
				}

				decodedPayload, err := protobuf.DecodeFromProtoBytes(params.Payload, descriptor)
				if err != nil {
					slog.Debug(fmt.Sprintf("proto decode middleware: %s", err.Error()))
					(*params.MiddlewareProperties)["ProtoDecode"] = "failed"
					(*params.MiddlewareProperties)["ProtoDescriptorName"] = match.MessageType
					return nil
				}

				(*params.MiddlewareProperties)["ProtoDecode"] = "ok"
				(*params.MiddlewareProperties)["ProtoDescriptorName"] = match.MessageType
				// Legacy flag, kept so any frontend code that hasn't migrated to
				// the ProtoDecode marker yet still sees a decoded message.
				(*params.MiddlewareProperties)["IsDecodedProto"] = true
				params.Payload = decodedPayload
				return nil
			},
		},
	}
}
