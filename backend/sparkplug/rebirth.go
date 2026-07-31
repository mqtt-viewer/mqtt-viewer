package sparkplug

import "fmt"

// dataTypeBoolean is the Sparkplug DataType enum index for Boolean.
const dataTypeBoolean = 11

// RebirthTopic builds the NCMD topic for a node rebirth request.
func RebirthTopic(group string, edgeNode string) string {
	return fmt.Sprintf("spBv1.0/%s/NCMD/%s", group, edgeNode)
}

// RebirthPayloadJSON builds the protojson body for the standard
// Node Control/Rebirth command. Field names must match protojson for
// SparkplugBPayload so the proto-encode publish middleware accepts it
// (uint64 timestamp is quoted, per canonical protojson).
func RebirthPayloadJSON(timestampMs int64) string {
	return fmt.Sprintf(
		`{"timestamp":"%d","metrics":[{"name":"Node Control/Rebirth","datatype":%d,"booleanValue":true}]}`,
		timestampMs, dataTypeBoolean,
	)
}
