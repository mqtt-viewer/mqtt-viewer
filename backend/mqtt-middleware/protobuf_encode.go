package mqttmiddleware

import (
	"fmt"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"

	"google.golang.org/protobuf/reflect/protoreflect"
)

type ProtoEncodeMiddleware struct {
	mqtt.Middleware[mqtt.MqttPublishParams]
}

var PROTO_ENCODE_MIDDLEWARE_ID = "ProtoEncodeMiddleware"

// NewProtoEncodeMiddleware encodes an outgoing publish's JSON payload to
// protobuf bytes per params.ProtoOverride: nil resolves via the matcher
// (rule or implicit sparkplug), "" skips encoding (raw), and any other value
// forces that message type. Unlike decode, encode failures are fatal: the
// publish is rejected rather than sent with a payload the caller didn't ask
// for.
func NewProtoEncodeMiddleware(resolver ProtoResolver, sparkplugRegistry SparkplugRegistryFunc) *ProtoEncodeMiddleware {
	return &ProtoEncodeMiddleware{
		Middleware: mqtt.Middleware[mqtt.MqttPublishParams]{
			ID: PROTO_ENCODE_MIDDLEWARE_ID,
			Func: func(params *mqtt.MqttPublishParams) error {
				if !resolver.IsEnabled() {
					return nil
				}
				if len(params.Payload) == 0 {
					// Zero-length payloads are retained-clear semantics; never
					// encode them.
					return nil
				}

				switch {
				case params.ProtoOverride == nil:
					match := resolver.Match(params.Topic)
					if match.Source == "" {
						return nil
					}
					descriptor, ok := resolveDescriptor(resolver, sparkplugRegistry, match.Source, match.MessageType)
					if !ok {
						if match.Source == topicmatching.SourceSparkplug {
							// Global sparkplug registry not loaded yet: pass the message
							// through raw, matching the decode middleware's exception
							// for the same case.
							return nil
						}
						return fmt.Errorf("unknown protobuf type %s", match.MessageType)
					}
					return encodeProtoPayload(params, descriptor, match.MessageType)
				case *params.ProtoOverride == "":
					// Explicit raw override: skip encoding.
					return nil
				default:
					typeName := *params.ProtoOverride
					descriptor, ok := resolver.RuleDescriptor(typeName)
					if !ok {
						if reg := sparkplugRegistry(); reg != nil {
							descriptor, ok = reg.GetMessageDescriptorFromName(typeName)
						}
					}
					if !ok {
						return fmt.Errorf("unknown protobuf type %s", typeName)
					}
					return encodeProtoPayload(params, descriptor, typeName)
				}
			},
		},
	}
}

func encodeProtoPayload(params *mqtt.MqttPublishParams, descriptor protoreflect.MessageDescriptor, typeName string) error {
	encoded, err := protobuf.EncodeFromJSONBytes(params.Payload, descriptor)
	if err != nil {
		return fmt.Errorf("protobuf encode as %s failed: %w", typeName, err)
	}
	params.Payload = encoded
	return nil
}
