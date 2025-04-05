package mqttmiddleware

import (
	"fmt"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"

	"golang.org/x/exp/slog"
	"google.golang.org/protobuf/reflect/protoreflect"
)

type ProtoDecodeMiddleware struct {
	mqtt.Middleware[mqtt.MqttMessage]
}

var PROTO_DECODE_MIDDLEWARE_ID = "ProtoDecodeMiddleware"

func NewProtoDecodeMiddleware(protoRegistry *protobuf.ProtoRegistry) *ProtoDecodeMiddleware {
	return &ProtoDecodeMiddleware{
		Middleware: mqtt.Middleware[mqtt.MqttMessage]{
			ID: PROTO_ENCODE_MIDDLEWARE_ID,
			Func: func(params *mqtt.MqttMessage) error {
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
					// No need to encode
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
				(*params.MiddlewareProperties)["IsDecodedProto"] = true
				params.Payload = decodedPayload
				return nil
			},
		},
	}
}
