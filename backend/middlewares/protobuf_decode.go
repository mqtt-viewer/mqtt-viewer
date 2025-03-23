package middlewares

import (
	"fmt"
	"mqtt-viewer/backend/matchers"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"

	"golang.org/x/exp/slog"
)

type ProtoDecodeMiddleware struct {
	mqtt.Middleware[mqtt.MqttMessage]
	protoMatcher *matchers.ProtoMatcher
}

var PROTO_DECODE_MIDDLEWARE_ID = "ProtoDecodeMiddleware"

func NewProtoDecodeMiddleware(protoMatcher *matchers.ProtoMatcher) *ProtoDecodeMiddleware {
	return &ProtoDecodeMiddleware{
		Middleware: mqtt.Middleware[mqtt.MqttMessage]{
			ID: PROTO_ENCODE_MIDDLEWARE_ID,
			Func: func(params *mqtt.MqttMessage) error {
				matchedDescriptor := protoMatcher.GetMatchingProtoDescriptor(params.Topic)
				if matchedDescriptor == nil {
					return nil
				}
				decodedPayload, err := protobuf.DecodeFromProtoBytes(params.Payload, matchedDescriptor)
				if err != nil {
					// Don't error - just use payload as normal
					slog.Debug(fmt.Sprintf("proto decode middleware error: %s", err.Error()))
					return nil
				}
				if decodedPayload == nil {
					return nil
				}
				(*params.MiddlewareProperties)["IsDecodedProto"] = true
				params.Payload = decodedPayload
				return nil
			},
		},

		protoMatcher: protoMatcher,
	}
}
