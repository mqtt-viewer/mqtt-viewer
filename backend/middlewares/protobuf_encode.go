package middlewares

import (
	"fmt"
	"mqtt-viewer/backend/matchers"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
)

type ProtoEncodeMiddleware struct {
	mqtt.Middleware[mqtt.MqttPublishParams]
	protoMatcher *matchers.ProtoMatcher
}

var PROTO_ENCODE_MIDDLEWARE_ID = "ProtoEncodeMiddleware"

func NewProtoEncodeMiddleware(protoMatcher *matchers.ProtoMatcher) *ProtoEncodeMiddleware {
	return &ProtoEncodeMiddleware{
		Middleware: mqtt.Middleware[mqtt.MqttPublishParams]{
			ID: PROTO_ENCODE_MIDDLEWARE_ID,
			Func: func(params *mqtt.MqttPublishParams) error {
				matchedDescriptor := protoMatcher.GetMatchingProtoDescriptor(params.Topic)
				if matchedDescriptor == nil {
					return nil
				}
				encodedPayload, err := protobuf.EncodeFromJSONBytes(params.Payload, matchedDescriptor)
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

		protoMatcher: protoMatcher,
	}
}
