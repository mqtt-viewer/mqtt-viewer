package sparkplug

import (
	"mqtt-viewer/backend/protobuf"
	"testing"
)

func TestRebirthTopic(t *testing.T) {
	got := RebirthTopic("EnergyCo", "substation-7")
	want := "spBv1.0/EnergyCo/NCMD/substation-7"
	if got != want {
		t.Errorf("RebirthTopic = %q, want %q", got, want)
	}
}

// The rebirth payload is JSON handed to the proto-encode publish middleware,
// so its field names must round-trip through the SparkplugBPayload schema.
func TestRebirthPayloadEncodesAndRoundTrips(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	payload := RebirthPayloadJSON(1752800000000)

	protoBytes, err := protobuf.EncodeFromJSONBytes([]byte(payload), descriptor)
	if err != nil {
		t.Fatalf("rebirth payload rejected by proto encode: %v", err)
	}

	msg, err := protobuf.UnmarshalToDynamic(protoBytes, descriptor)
	if err != nil {
		t.Fatalf("decoding rebirth payload: %v", err)
	}

	fields := descriptor.Fields()
	if got := msg.Get(fields.ByName("timestamp")).Uint(); got != 1752800000000 {
		t.Errorf("expected timestamp 1752800000000, got %v", got)
	}
	list, ok := metricsList(msg)
	if !ok || list.Len() != 1 {
		t.Fatalf("expected exactly one metric in rebirth payload")
	}
	metric := list.Get(0).Message()
	if name := metricName(metric); name != "Node Control/Rebirth" {
		t.Errorf("expected metric name Node Control/Rebirth, got %q", name)
	}
	metricFields := metric.Descriptor().Fields()
	if got := metric.Get(metricFields.ByName("datatype")).Uint(); got != dataTypeBoolean {
		t.Errorf("expected datatype %d, got %v", dataTypeBoolean, got)
	}
	boolField := metricFields.ByName("boolean_value")
	if !metric.Has(boolField) || !metric.Get(boolField).Bool() {
		t.Error("expected boolean_value true")
	}
}
