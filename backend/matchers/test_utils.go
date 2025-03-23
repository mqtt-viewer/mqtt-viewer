package matchers

import (
	"context"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/protobuf"
	"path"
	"runtime"
	"testing"

	"gopkg.in/guregu/null.v4"
)

var _, filename, _, _ = runtime.Caller(0)
var testDir = path.Dir(filename)

func GetTestProtoMatcher(t *testing.T) *ProtoMatcher {
	protoRegistry, err := protobuf.LoadProtoRegistry(testDir)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	var qos uint = 0
	subs := []models.Subscription{
		{
			Topic:           "topic/proto",
			QoS:             &qos,
			ProtoDescriptor: null.NewString("test.HelloMessage", true),
		},
		{
			Topic:           "topic/proto/complex",
			QoS:             &qos,
			ProtoDescriptor: null.NewString("complex.Employee", true),
		},
		{
			Topic: "topic/no-proto",
			QoS:   &qos,
		},
	}
	subMatcher := NewSubscriptionMatcher(subs)
	return NewProtoMatcher(context.Background(), subMatcher, *protoRegistry.LoadedDescriptorsNameMap)
}
