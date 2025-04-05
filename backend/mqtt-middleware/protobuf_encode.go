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

func NewProtoEncodeMiddleware(protoRegistry *protobuf.ProtoRegistry) *ProtoEncodeMiddleware {
	return &ProtoEncodeMiddleware{
		Middleware: mqtt.Middleware[mqtt.MqttPublishParams]{
			ID: PROTO_ENCODE_MIDDLEWARE_ID,
			Func: func(params *mqtt.MqttPublishParams) error {
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

				encodedPayload, err := protobuf.EncodeFromJSONBytes(params.Payload, *descriptor)
				if err != nil {
					// Throw error - don't allow publishing messages that can't be encoded
					return fmt.Errorf("proto encode middleware error: %w", err)
				}
				if encodedPayload == nil {
					return nil
				}
				params.Payload = encodedPayload
				return nil
			},
		},
	}
}
