package mqtt

import "testing"

// Sparkplug decoding attaches a meta map to every message it handles, so the
// history budget has to count it. Before it did, a connection on a busy
// Sparkplug broker retained well over its budget.
func TestEstimatedBytesCountsMiddlewareProperties(t *testing.T) {
	plain := msg("spBv1.0/Group/NDATA/EdgeNode", 128)

	withMeta := msg("spBv1.0/Group/NDATA/EdgeNode", 128)
	withMeta.MiddlewareProperties = &map[string]any{
		"IsDecodedProto": true,
		"sparkplug": map[string]any{
			"msgType":    "NDATA",
			"group":      "Sparkplug B Devices",
			"edgeNode":   "Raspberry Pi",
			"resolution": "resolved",
			"birthAtMs":  int64(1700000000000),
			"seqGap":     map[string]any{"expected": 4, "got": 7},
		},
	}

	extra := withMeta.estimatedBytes() - plain.estimatedBytes()
	if extra < 100 {
		t.Errorf("expected sparkplug meta to add a meaningful cost, got %d extra bytes", extra)
	}
}

func TestEstimatedBytesIgnoresEmptyMiddlewareProperties(t *testing.T) {
	plain := msg("a/b", 32)
	empty := msg("a/b", 32)
	empty.MiddlewareProperties = &map[string]any{}

	if plain.estimatedBytes() != empty.estimatedBytes() {
		t.Errorf("expected an empty middleware map to cost nothing extra, got %d vs %d",
			empty.estimatedBytes(), plain.estimatedBytes())
	}
}

// Depth limiting keeps the estimate cheap on the receive path; a deeply nested
// value must still terminate at a bounded cost rather than walking every level.
func TestEstimatedValueBytesIsDepthLimited(t *testing.T) {
	deep := map[string]any{"a": map[string]any{"b": map[string]any{"c": map[string]any{"d": "unreachable"}}}}
	if got := estimatedValueBytes(deep, maxValueDepth); got > 4*nestedFlatCost {
		t.Errorf("expected a bounded cost for a deeply nested value, got %d", got)
	}
}
