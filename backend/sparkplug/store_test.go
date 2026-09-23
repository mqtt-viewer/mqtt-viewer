package sparkplug

import (
	"fmt"
	"mqtt-viewer/backend/protobuf"
	"strings"
	"testing"
	"unicode/utf8"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// loadPayloadDescriptor compiles the embedded Sparkplug protos in a temp dir
// and returns the SparkplugBPayload descriptor, mirroring how the app builds
// its registry at startup.
func loadPayloadDescriptor(t *testing.T) protoreflect.MessageDescriptor {
	t.Helper()
	dir := t.TempDir()
	if err := protobuf.WriteSparkplugProtoFiles(dir); err != nil {
		t.Fatalf("writing sparkplug proto files: %v", err)
	}
	registry, err := protobuf.LoadProtoRegistry(dir)
	if err != nil {
		t.Fatalf("loading proto registry: %v", err)
	}
	descriptor, ok := registry.GetMessageDescriptorFromName("SparkplugBPayload")
	if !ok {
		t.Fatal("SparkplugBPayload descriptor not found in registry")
	}
	return descriptor
}

type testMetric struct {
	name        string
	alias       *uint64
	longValue   *uint64
	doubleValue *float64
}

func u64(v uint64) *uint64 { return &v }

var refCounter int

// at builds a unique message ref for a message arriving at ms. The topic is
// left empty: the store never reads it, only hands it back for replay.
func at(ms int64) MessageRef {
	refCounter++
	return MessageRef{ID: fmt.Sprintf("m%d", refCounter), TimeMs: ms}
}
func f64(v float64) *float64 { return &v }

// buildPayload constructs a SparkplugBPayload dynamic message. seq < 0 omits
// the seq field.
func buildPayload(t *testing.T, descriptor protoreflect.MessageDescriptor, seq int64, metrics ...testMetric) *dynamicpb.Message {
	t.Helper()
	msg := dynamicpb.NewMessage(descriptor)
	fields := descriptor.Fields()
	if seq >= 0 {
		msg.Set(fields.ByName("seq"), protoreflect.ValueOfUint64(uint64(seq)))
	}
	list := msg.Mutable(fields.ByName("metrics")).List()
	for _, m := range metrics {
		metric := list.NewElement().Message()
		metricFields := metric.Descriptor().Fields()
		if m.name != "" {
			metric.Set(metricFields.ByName("name"), protoreflect.ValueOfString(m.name))
		}
		if m.alias != nil {
			metric.Set(metricFields.ByName("alias"), protoreflect.ValueOfUint64(*m.alias))
		}
		if m.longValue != nil {
			metric.Set(metricFields.ByName("long_value"), protoreflect.ValueOfUint64(*m.longValue))
		}
		if m.doubleValue != nil {
			metric.Set(metricFields.ByName("double_value"), protoreflect.ValueOfFloat64(*m.doubleValue))
		}
		list.Append(protoreflect.ValueOfMessage(metric))
	}
	return msg
}

// payloadMetricNames reads back the (possibly injected) name of each metric.
func payloadMetricNames(msg *dynamicpb.Message) []string {
	names := []string{}
	list, ok := metricsList(msg)
	if !ok {
		return names
	}
	for i := 0; i < list.Len(); i++ {
		names = append(names, metricName(list.Get(i).Message()))
	}
	return names
}

var (
	nbirthInfo = TopicInfo{Group: "G", Type: MessageTypeNBirth, EdgeNode: "N"}
	ndataInfo  = TopicInfo{Group: "G", Type: MessageTypeNData, EdgeNode: "N"}
	ndeathInfo = TopicInfo{Group: "G", Type: MessageTypeNDeath, EdgeNode: "N"}
	dbirthInfo = TopicInfo{Group: "G", Type: MessageTypeDBirth, EdgeNode: "N", Device: "D"}
	ddataInfo  = TopicInfo{Group: "G", Type: MessageTypeDData, EdgeNode: "N", Device: "D"}
	ddeathInfo = TopicInfo{Group: "G", Type: MessageTypeDDeath, EdgeNode: "N", Device: "D"}
)

func TestBirthThenDataResolves(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	birthAt := at(1000)

	birth := buildPayload(t, descriptor, 0,
		testMetric{name: "Volts/L1", alias: u64(3)},
		testMetric{name: "Amps/L1", alias: u64(5)},
	)
	meta := store.HandleMessage(nbirthInfo, birth, birthAt)
	if meta["msgType"] != "NBIRTH" || meta["group"] != "G" || meta["edgeNode"] != "N" {
		t.Errorf("unexpected birth meta: %+v", meta)
	}

	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(239.9)})
	meta = store.HandleMessage(ndataInfo, data, at(2000))
	if meta["resolution"] != ResolutionResolved {
		t.Errorf("expected resolution %q, got %v", ResolutionResolved, meta["resolution"])
	}
	if meta["birthAtMs"] != int64(1000) {
		t.Errorf("expected birthAtMs 1000, got %v", meta["birthAtMs"])
	}
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no seqGap, got %v", meta["seqGap"])
	}
	names := payloadMetricNames(data)
	if len(names) != 1 || names[0] != "Volts/L1" {
		t.Errorf("expected injected name Volts/L1, got %v", names)
	}
}

func TestDataBeforeBirthUnresolved(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	data := buildPayload(t, descriptor, 4, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta := store.HandleMessage(ndataInfo, data, at(1000))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected resolution %q, got %v", ResolutionUnresolved, meta["resolution"])
	}
	if _, ok := meta["birthAtMs"]; ok {
		t.Errorf("expected no birthAtMs without a birth, got %v", meta["birthAtMs"])
	}
	if names := payloadMetricNames(data); names[0] != "" {
		t.Errorf("expected no name injected, got %v", names)
	}
}

func TestRebirthFlushesAliases(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	firstBirth := buildPayload(t, descriptor, 0, testMetric{name: "Old/Metric", alias: u64(3)})
	store.HandleMessage(nbirthInfo, firstBirth, at(1000))

	// The rebirth drops alias 3 entirely — never merge with the old map.
	rebirth := buildPayload(t, descriptor, 0, testMetric{name: "New/Metric", alias: u64(4)})
	store.HandleMessage(nbirthInfo, rebirth, at(2000))

	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta := store.HandleMessage(ndataInfo, data, at(3000))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected stale alias to stay unresolved, got %v", meta["resolution"])
	}
	if names := payloadMetricNames(data); names[0] != "" {
		t.Errorf("expected stale alias to get no name, got %v", names)
	}
}

func TestNodeAndDeviceAliasSpacesAreSeparate(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	nodeBirth := buildPayload(t, descriptor, 0, testMetric{name: "Node/Metric", alias: u64(3)})
	store.HandleMessage(nbirthInfo, nodeBirth, at(1000))
	deviceBirth := buildPayload(t, descriptor, 1, testMetric{name: "Device/Metric", alias: u64(3)})
	store.HandleMessage(dbirthInfo, deviceBirth, at(1500))

	ddata := buildPayload(t, descriptor, 2, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta := store.HandleMessage(ddataInfo, ddata, at(2000))
	if meta["resolution"] != ResolutionResolved {
		t.Fatalf("expected device data resolved, got %v", meta["resolution"])
	}
	if names := payloadMetricNames(ddata); names[0] != "Device/Metric" {
		t.Errorf("expected Device/Metric from device alias space, got %v", names)
	}
	if meta["device"] != "D" {
		t.Errorf("expected device meta D, got %v", meta["device"])
	}

	ndata := buildPayload(t, descriptor, 3, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta = store.HandleMessage(ndataInfo, ndata, at(2500))
	if names := payloadMetricNames(ndata); names[0] != "Node/Metric" {
		t.Errorf("expected Node/Metric from node alias space, got %v", names)
	}
	if _, ok := meta["device"]; ok {
		t.Errorf("expected no device meta on NDATA, got %v", meta["device"])
	}
}

func TestSeqGapDetection(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(1000))

	meta := store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 1), at(1100))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no gap at seq 1, got %v", meta["seqGap"])
	}

	meta = store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 3), at(1200))
	gap, ok := meta["seqGap"].(map[string]any)
	if !ok {
		t.Fatalf("expected seqGap at seq 3, got %v", meta["seqGap"])
	}
	if gap["expected"] != 2 || gap["got"] != 3 {
		t.Errorf("expected gap {expected:2 got:3}, got %v", gap)
	}

	// LastSeq must track the received value, so 4 after 3 is clean again.
	meta = store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 4), at(1300))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no gap at seq 4, got %v", meta["seqGap"])
	}
}

func TestSeqWraparoundIsNotAGap(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 255), at(1000))

	meta := store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 0), at(1100))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected 255->0 wraparound to be clean, got %v", meta["seqGap"])
	}

	meta = store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 2), at(1200))
	gap, ok := meta["seqGap"].(map[string]any)
	if !ok {
		t.Fatalf("expected gap at seq 2, got %v", meta["seqGap"])
	}
	if gap["expected"] != 1 || gap["got"] != 2 {
		t.Errorf("expected gap {expected:1 got:2}, got %v", gap)
	}
}

// The spec-compliant order every edge node follows: one shared counter,
// consumed by every message except NDEATH. DDEATH skipping the counter was the
// live bug behind spurious gap warnings on the next NDATA.
func TestSpecCompliantSequenceHasNoSeqGaps(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	steps := []struct {
		name string
		info TopicInfo
		seq  int64
	}{
		{"NBIRTH", nbirthInfo, 0},
		{"DBIRTH", dbirthInfo, 1},
		{"DDATA", ddataInfo, 2},
		{"DDEATH", ddeathInfo, 3},
		{"NDATA", ndataInfo, 4},
	}
	for _, step := range steps {
		meta := store.HandleMessage(step.info, buildPayload(t, descriptor, step.seq), at(1000+step.seq))
		if meta == nil {
			t.Fatalf("%s: expected meta, got nil", step.name)
		}
		if gap, ok := meta["seqGap"]; ok {
			t.Errorf("%s (seq %d): expected no seqGap, got %v", step.name, step.seq, gap)
		}
	}
}

func TestNBirthNonZeroSeqReportsGapAndIsAccepted(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	birth := buildPayload(t, descriptor, 7, testMetric{name: "Volts/L1", alias: u64(3)})
	meta := store.HandleMessage(nbirthInfo, birth, at(1000))
	gap, ok := meta["seqGap"].(map[string]any)
	if !ok {
		t.Fatalf("expected seqGap on an NBIRTH with a non-zero seq, got %v", meta["seqGap"])
	}
	if gap["expected"] != 0 || gap["got"] != 7 {
		t.Errorf("expected gap {expected:0 got:7}, got %v", gap)
	}

	// Still accepted: the birth's aliases apply and seq 8 follows cleanly.
	data := buildPayload(t, descriptor, 8, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta = store.HandleMessage(ndataInfo, data, at(2000))
	if meta["resolution"] != ResolutionResolved {
		t.Errorf("expected the non-zero birth to still resolve aliases, got %v", meta["resolution"])
	}
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no seqGap at seq 8, got %v", meta["seqGap"])
	}
}

func TestDBirthOutOfOrderSeqReportsGap(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(1000))

	meta := store.HandleMessage(dbirthInfo, buildPayload(t, descriptor, 5, testMetric{name: "Device/Metric", alias: u64(3)}), at(1100))
	gap, ok := meta["seqGap"].(map[string]any)
	if !ok {
		t.Fatalf("expected seqGap on an out-of-order DBIRTH, got %v", meta["seqGap"])
	}
	if gap["expected"] != 1 || gap["got"] != 5 {
		t.Errorf("expected gap {expected:1 got:5}, got %v", gap)
	}

	meta = store.HandleMessage(ddataInfo, buildPayload(t, descriptor, 6, testMetric{alias: u64(3), doubleValue: f64(1.0)}), at(1200))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no seqGap at seq 6, got %v", meta["seqGap"])
	}
}

func TestNDeathInvalidatesAliasesAndCarriesBdSeq(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	birth := buildPayload(t, descriptor, 0,
		testMetric{name: "bdSeq", longValue: u64(3)},
		testMetric{name: "Node/Metric", alias: u64(3)},
	)
	meta := store.HandleMessage(nbirthInfo, birth, at(1000))
	if meta["bdSeq"] != uint64(3) {
		t.Errorf("expected birth bdSeq 3, got %v", meta["bdSeq"])
	}
	store.HandleMessage(dbirthInfo, buildPayload(t, descriptor, 1, testMetric{name: "Device/Metric", alias: u64(3)}), at(1100))

	death := buildPayload(t, descriptor, -1, testMetric{name: "bdSeq", longValue: u64(3)})
	meta = store.HandleMessage(ndeathInfo, death, at(2000))
	if meta["bdSeq"] != uint64(3) {
		t.Errorf("expected death bdSeq 3, got %v", meta["bdSeq"])
	}
	if _, ok := meta["staleDeath"]; ok {
		t.Errorf("expected a matching bdSeq to be accepted, got staleDeath %v", meta["staleDeath"])
	}

	ndata := buildPayload(t, descriptor, 2, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta = store.HandleMessage(ndataInfo, ndata, at(3000))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected node aliases dropped by NDEATH, got %v", meta["resolution"])
	}

	// The death takes the node's devices with it.
	ddata := buildPayload(t, descriptor, 3, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta = store.HandleMessage(ddataInfo, ddata, at(3100))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected device aliases dropped by NDEATH, got %v", meta["resolution"])
	}
}

func TestNDeathWithoutBdSeqIsAccepted(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	birth := buildPayload(t, descriptor, 0,
		testMetric{name: "bdSeq", longValue: u64(3)},
		testMetric{name: "Node/Metric", alias: u64(3)},
	)
	store.HandleMessage(nbirthInfo, birth, at(1000))

	// A will with no bdSeq metric can't be attributed to an older session, so
	// it has to be treated as the current one dying.
	meta := store.HandleMessage(ndeathInfo, buildPayload(t, descriptor, -1), at(2000))
	if _, ok := meta["staleDeath"]; ok {
		t.Errorf("expected a bdSeq-less death to be accepted, got staleDeath %v", meta["staleDeath"])
	}

	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta = store.HandleMessage(ndataInfo, data, at(3000))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected aliases dropped by NDEATH, got %v", meta["resolution"])
	}
}

func TestStaleNDeathIsIgnored(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	birth := buildPayload(t, descriptor, 0,
		testMetric{name: "bdSeq", longValue: u64(3)},
		testMetric{name: "Node/Metric", alias: u64(3)},
	)
	store.HandleMessage(nbirthInfo, birth, at(1000))

	// Retained will from the session before this one.
	death := buildPayload(t, descriptor, -1, testMetric{name: "bdSeq", longValue: u64(2)})
	meta := store.HandleMessage(ndeathInfo, death, at(2000))
	if meta["staleDeath"] != true {
		t.Errorf("expected staleDeath true for a mismatched bdSeq, got %v", meta["staleDeath"])
	}
	if meta["bdSeq"] != uint64(2) {
		t.Errorf("expected the death's own bdSeq 2 in meta, got %v", meta["bdSeq"])
	}

	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta = store.HandleMessage(ndataInfo, data, at(3000))
	if meta["resolution"] != ResolutionResolved {
		t.Errorf("expected the live birth to keep resolving, got %v", meta["resolution"])
	}
	if names := payloadMetricNames(data); names[0] != "Node/Metric" {
		t.Errorf("expected Node/Metric after a stale death, got %v", names)
	}
}

func TestNilPayloadNDeath(t *testing.T) {
	store := NewSessionStore()
	meta := store.HandleMessage(ndeathInfo, nil, at(1000))
	if meta["msgType"] != "NDEATH" {
		t.Errorf("expected NDEATH meta, got %v", meta)
	}
	if _, ok := meta["bdSeq"]; ok {
		t.Errorf("expected no bdSeq for nil payload, got %v", meta["bdSeq"])
	}
}

func TestNamesOnWirePassthrough(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts/L1", alias: u64(3)}), at(1000))
	data := buildPayload(t, descriptor, 1, testMetric{name: "Volts/L1", doubleValue: f64(240.0)})
	meta := store.HandleMessage(ndataInfo, data, at(2000))
	if meta["resolution"] != ResolutionNames {
		t.Errorf("expected resolution %q, got %v", ResolutionNames, meta["resolution"])
	}
	if _, ok := meta["birthAtMs"]; ok {
		t.Errorf("expected no birthAtMs when nothing was resolved, got %v", meta["birthAtMs"])
	}
}

func TestPartialResolution(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts/L1", alias: u64(3)}), at(1000))
	data := buildPayload(t, descriptor, 1,
		testMetric{alias: u64(3), doubleValue: f64(1.0)},
		testMetric{alias: u64(9), doubleValue: f64(2.0)},
	)
	meta := store.HandleMessage(ndataInfo, data, at(2000))
	if meta["resolution"] != ResolutionPartial {
		t.Errorf("expected resolution %q, got %v", ResolutionPartial, meta["resolution"])
	}
	names := payloadMetricNames(data)
	if names[0] != "Volts/L1" || names[1] != "" {
		t.Errorf("expected [Volts/L1, \"\"], got %v", names)
	}
}

func TestStateMeta(t *testing.T) {
	store := NewSessionStore()
	info := TopicInfo{Type: MessageTypeState, HostID: "scada-primary"}
	meta := store.HandleMessage(info, nil, at(1000))
	if meta["msgType"] != "STATE" || meta["hostId"] != "scada-primary" {
		t.Errorf("unexpected STATE meta: %+v", meta)
	}
	if _, ok := meta["group"]; ok {
		t.Errorf("expected no group on STATE meta, got %v", meta["group"])
	}
}

func TestBuildAliasMapSanitisesInvalidUTF8(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	msg := buildPayload(t, descriptor, 0, testMetric{name: "\xff\xfe\x00", alias: u64(3)})

	aliases := buildAliasMap(msg)
	name, ok := aliases[3]
	if !ok {
		t.Fatal("expected alias 3 in map")
	}
	if !utf8.ValidString(name) {
		t.Errorf("expected sanitised name to be valid UTF-8, got %q", name)
	}
	want := strings.ToValidUTF8("\xff\xfe\x00", "�")
	if name != want {
		t.Errorf("expected sanitised name %q, got %q", want, name)
	}
}

func TestSessionStoreCapsNodeTracking(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	for i := 0; i < maxTrackedNodes; i++ {
		info := TopicInfo{Group: "G", Type: MessageTypeNBirth, EdgeNode: fmt.Sprintf("N%d", i)}
		store.HandleMessage(info, buildPayload(t, descriptor, 0, testMetric{name: "M", alias: u64(1)}), at(1000))
	}
	if len(store.nodes) != maxTrackedNodes {
		t.Fatalf("expected %d nodes tracked, got %d", maxTrackedNodes, len(store.nodes))
	}

	// An already-tracked node keeps working past the cap.
	existingBirth := TopicInfo{Group: "G", Type: MessageTypeNBirth, EdgeNode: "N0"}
	store.HandleMessage(existingBirth, buildPayload(t, descriptor, 1, testMetric{name: "Volts/L1", alias: u64(3)}), at(2000))
	existingData := TopicInfo{Group: "G", Type: MessageTypeNData, EdgeNode: "N0"}
	meta := store.HandleMessage(existingData, buildPayload(t, descriptor, 2, testMetric{alias: u64(3), doubleValue: f64(1.0)}), at(3000))
	if meta["resolution"] != ResolutionResolved {
		t.Errorf("expected existing node to keep resolving, got %v", meta["resolution"])
	}

	// A brand-new node past the cap gets no meta at all, so the frontend never
	// builds tree state for a node the store isn't following.
	newNodeInfo := TopicInfo{Group: "G", Type: MessageTypeNData, EdgeNode: "new-node"}
	data := buildPayload(t, descriptor, 5, testMetric{alias: u64(3), doubleValue: f64(2.0)})
	meta = store.HandleMessage(newNodeInfo, data, at(4000))
	if meta != nil {
		t.Errorf("expected nil meta for capped node, got %v", meta)
	}
	if names := payloadMetricNames(data); names[0] != "" {
		t.Errorf("expected no name injected for capped node, got %v", names)
	}
	if len(store.nodes) != maxTrackedNodes {
		t.Errorf("expected node count to stay capped at %d, got %d", maxTrackedNodes, len(store.nodes))
	}
}

func TestSessionStoreCapsDeviceTracking(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(1000))

	for i := 0; i < maxTrackedDevices; i++ {
		info := TopicInfo{Group: "G", Type: MessageTypeDBirth, EdgeNode: "N", Device: fmt.Sprintf("D%d", i)}
		store.HandleMessage(info, buildPayload(t, descriptor, 0, testMetric{name: "M", alias: u64(1)}), at(1000))
	}

	// A device past the cap gets no meta, so the frontend never allocates
	// tree state for it, but it still advances its node's shared seq counter.
	newDeviceInfo := TopicInfo{Group: "G", Type: MessageTypeDData, EdgeNode: "N", Device: "new-device"}
	meta := store.HandleMessage(newDeviceInfo, buildPayload(t, descriptor, 1, testMetric{alias: u64(1), doubleValue: f64(1.0)}), at(2000))
	if meta != nil {
		t.Fatalf("expected nil meta for a capped device, got %v", meta)
	}
	meta = store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 2), at(3000))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected the capped device's seq to count, got gap %v", meta["seqGap"])
	}

	node := store.nodes[nodeKey{"G", "N"}]
	if node == nil || len(node.Devices) != maxTrackedDevices {
		t.Errorf("expected device count to stay capped at %d", maxTrackedDevices)
	}
}

func TestResetClearsEverything(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts/L1", alias: u64(3)}), at(1000))
	store.Reset()

	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta := store.HandleMessage(ndataInfo, data, at(2000))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected unresolved after reset, got %v", meta["resolution"])
	}
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no seqGap after reset (LastSeq forgotten), got %v", meta["seqGap"])
	}
}

func TestNBirthInvalidatesDeviceAliases(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(1))
	store.HandleMessage(dbirthInfo, buildPayload(t, descriptor, 1, testMetric{name: "OldName", alias: u64(1)}), at(2))
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(3))

	// Sparkplug requires a fresh DBIRTH after every NBIRTH; until it arrives the
	// device's old aliases may already mean something else.
	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(1), doubleValue: f64(1)})
	meta := store.HandleMessage(ddataInfo, data, at(4))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected unresolved before the new DBIRTH, got %v", meta["resolution"])
	}
	if names := payloadMetricNames(data); names[0] != "" {
		t.Errorf("expected no stale name injected, got %v", names)
	}

	store.HandleMessage(dbirthInfo, buildPayload(t, descriptor, 2, testMetric{name: "NewName", alias: u64(1)}), at(5))
	data = buildPayload(t, descriptor, 3, testMetric{alias: u64(1), doubleValue: f64(1)})
	store.HandleMessage(ddataInfo, data, at(6))
	if names := payloadMetricNames(data); names[0] != "NewName" {
		t.Errorf("expected the new DBIRTH's name, got %v", names)
	}
}

func TestNBirthWithoutBdSeqForgetsThePreviousOne(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "bdSeq", longValue: u64(5)}), at(1))
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(2))
	meta := store.HandleMessage(ndeathInfo, buildPayload(t, descriptor, -1, testMetric{name: "bdSeq", longValue: u64(6)}), at(3))
	if _, stale := meta["staleDeath"]; stale {
		t.Error("expected the death accepted: the live birth carried no bdSeq to contradict it")
	}
}

func TestSuspendKeepsNamesButFlagsThemCarriedOver(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts/L1", alias: u64(3)}), at(1000))
	store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(1)}), at(2000))
	store.Suspend()

	// The node kept publishing while this client was away, so its seq moved
	// on. Neither that nor the missing messages is the node's fault.
	data := buildPayload(t, descriptor, 40, testMetric{alias: u64(3), doubleValue: f64(2)})
	meta := store.HandleMessage(ndataInfo, data, at(9000))
	if meta["resolution"] != ResolutionResolved {
		t.Errorf("expected names to keep resolving after a drop, got %v", meta["resolution"])
	}
	if meta["carriedOver"] != true {
		t.Errorf("expected carriedOver after a drop, got %v", meta)
	}
	if meta["birthAtMs"] != int64(1000) {
		t.Errorf("expected the pre-drop birth time, got %v", meta["birthAtMs"])
	}
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no seq gap across our own outage, got %v", meta["seqGap"])
	}
	if names := payloadMetricNames(data); names[0] != "Volts/L1" {
		t.Errorf("expected carried-over name, got %v", names)
	}

	// A new birth verifies the node again.
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts/L1", alias: u64(3)}), at(10000))
	meta = store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(3)}), at(11000))
	if _, ok := meta["carriedOver"]; ok {
		t.Errorf("expected verified names after a new birth, got %v", meta)
	}
}

func TestSuspendForgetsBdSeq(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "bdSeq", longValue: u64(5)}), at(1))
	store.Suspend()
	// The node may have rebirthed with bdSeq 6 while this client was away,
	// so a death carrying 6 is a real death, not a stale one.
	meta := store.HandleMessage(ndeathInfo, buildPayload(t, descriptor, -1, testMetric{name: "bdSeq", longValue: u64(6)}), at(2))
	if _, stale := meta["staleDeath"]; stale {
		t.Error("expected the death accepted after a drop")
	}
}

func refIDs(refs []MessageRef) map[string]bool {
	ids := map[string]bool{}
	for _, ref := range refs {
		ids[ref.ID] = true
	}
	return ids
}

// dataValues flattens a replay's rebuilt data into "ord:metric=value" so tests
// can assert which message each latest value came from.
func dataValues(t *testing.T, data []ReplayData) map[string]uint64 {
	t.Helper()
	out := map[string]uint64{}
	for _, d := range data {
		list, ok := metricsList(d.Payload)
		if !ok {
			continue
		}
		for i := 0; i < list.Len(); i++ {
			metric := list.Get(i).Message()
			key := metricName(metric)
			if key == "" {
				alias, _ := metricAlias(metric)
				key = aliasKey(alias)
			}
			out[key] = d.Ord
		}
	}
	return out
}

// handled runs a message through the store and returns the ref it was given,
// Ord included.
func handled(store *SessionStore, info TopicInfo, msg *dynamicpb.Message, ref MessageRef) MessageRef {
	meta := store.HandleMessage(info, msg, ref)
	if n, ok := meta["n"].(uint64); ok {
		ref.Ord = n
	}
	return ref
}

func TestReplayKeepsTheLatestValueOfEveryMetric(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	birth := handled(store, nbirthInfo, buildPayload(t, descriptor, 0,
		testMetric{name: "A", alias: u64(1)},
		testMetric{name: "B", alias: u64(2)},
	), at(1))
	handled(store, ndataInfo, buildPayload(t, descriptor, 1, testMetric{alias: u64(1), doubleValue: f64(42)}), at(2))
	onlyB := handled(store, ndataInfo, buildPayload(t, descriptor, 2, testMetric{alias: u64(2), doubleValue: f64(7)}), at(3))
	secondA := handled(store, ndataInfo, buildPayload(t, descriptor, 3, testMetric{alias: u64(1), doubleValue: f64(43)}), at(4))

	// Report by exception: the latest NDATA carries only A, so B's latest
	// value comes from an older message. Both are rebuilt from the store, not
	// fetched, so history evicting them changes nothing.
	replay := store.Replay()
	if ids := refIDs(replay.Refs); !ids[birth.ID] || len(ids) != 1 {
		t.Errorf("expected only the birth to be fetched, got %v", ids)
	}
	values := dataValues(t, replay.Data)
	if values["A"] != secondA.Ord || values["B"] != onlyB.Ord || len(values) != 2 {
		t.Errorf("expected A from ord %d and B from ord %d, got %v", secondA.Ord, onlyB.Ord, values)
	}
	for _, d := range replay.Data {
		if d.Meta["msgType"] != "NDATA" || d.Meta["resolution"] != ResolutionResolved || d.Meta["n"] != d.Ord {
			t.Errorf("unexpected replay meta %v", d.Meta)
		}
	}
}

func TestReplayRebuildsTheValueItself(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	handled(store, nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts", alias: u64(3)}), at(1))
	handled(store, ndataInfo, buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(239.5)}), at(2))

	data := store.Replay().Data
	if len(data) != 1 {
		t.Fatalf("expected one rebuilt message, got %d", len(data))
	}
	list, _ := metricsList(data[0].Payload)
	metric := list.Get(0).Message()
	fd := metric.Descriptor().Fields().ByName("double_value")
	if metricName(metric) != "Volts" || metric.Get(fd).Float() != 239.5 {
		t.Errorf("expected Volts=239.5 rebuilt, got %s=%v", metricName(metric), metric.Get(fd))
	}
}

func TestReplayKeepsDeviceExistenceButNotItsOldSessionAfterNBirth(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	handled(store, nbirthInfo, buildPayload(t, descriptor, 0), at(1))
	oldDBirth := handled(store, dbirthInfo, buildPayload(t, descriptor, 1, testMetric{name: "M", alias: u64(1)}), at(2))
	handled(store, ddataInfo, buildPayload(t, descriptor, 2, testMetric{alias: u64(1), doubleValue: f64(1)}), at(3))
	handled(store, nbirthInfo, buildPayload(t, descriptor, 0), at(4))

	replay := store.Replay()
	// The old DBIRTH stays so the device still appears (awaiting its birth),
	// as it does in the live tree; the frontend ignores its metrics because
	// it predates the NBIRTH. Its old values are gone.
	if !refIDs(replay.Refs)[oldDBirth.ID] {
		t.Errorf("expected the old DBIRTH kept for the device's existence, got %v", refIDs(replay.Refs))
	}
	if values := dataValues(t, replay.Data); len(values) != 0 {
		t.Errorf("expected the previous device session's values dropped, got %v", values)
	}
}

func TestReplayIncludesDeathsGapsHostsAndRecentBirths(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	births := []MessageRef{}
	for i := 0; i < maxBirthRefsPerNode+2; i++ {
		births = append(births, handled(store, nbirthInfo, buildPayload(t, descriptor, 0), at(int64(i))))
	}
	gap := handled(store, ndataInfo, buildPayload(t, descriptor, 9), at(100))
	death := handled(store, ndeathInfo, nil, at(101))
	host := handled(store, TopicInfo{Type: MessageTypeState, HostID: "scada"}, nil, at(102))

	replay := store.Replay()
	ids := refIDs(replay.Refs)
	for _, want := range []MessageRef{gap, death, host, births[len(births)-1]} {
		if !ids[want.ID] {
			t.Errorf("expected %s in replay, got %v", want.ID, ids)
		}
	}
	birthCount := 0
	for _, b := range births {
		if ids[b.ID] {
			birthCount++
		}
	}
	if birthCount != maxBirthRefsPerNode {
		t.Errorf("expected %d recent births, got %d", maxBirthRefsPerNode, birthCount)
	}
	for _, ref := range replay.Refs {
		if ref.Ord == 0 {
			t.Errorf("expected every ref to carry its arrival order, got %+v", ref)
		}
	}
}

func TestArrivalOrderIsTotal(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	// Same millisecond, as in a node's connect burst.
	birth := handled(store, nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "A", alias: u64(1)}), at(5))
	data := handled(store, ndataInfo, buildPayload(t, descriptor, 1, testMetric{alias: u64(1), doubleValue: f64(1)}), at(5))
	if !(birth.Ord < data.Ord) {
		t.Errorf("expected the birth ordered before the data, got %d and %d", birth.Ord, data.Ord)
	}
	state := store.HandleMessage(TopicInfo{Type: MessageTypeState, HostID: "h"}, nil, at(5))
	if state["n"] != data.Ord+1 {
		t.Errorf("expected STATE to take the next order too, got %v", state["n"])
	}
}

func TestValueIndexIsCappedPerScope(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	// An unbirthed publisher cycling aliases must not grow the index forever.
	for i := 0; i < maxMetricsPerScope+10; i++ {
		store.HandleMessage(ndataInfo, buildPayload(t, descriptor, -1, testMetric{alias: u64(uint64(i)), doubleValue: f64(1)}), at(int64(i)))
	}
	node := store.nodes[nodeKey{"G", "N"}]
	if len(node.values) != maxMetricsPerScope {
		t.Errorf("expected %d values, got %d", maxMetricsPerScope, len(node.values))
	}
	if store.valuesTotal != maxMetricsPerScope || store.valueBytes != node.valueBytes || store.valueBytes == 0 {
		t.Errorf("expected totals to track the scope, got %d values, %d bytes (scope %d)", store.valuesTotal, store.valueBytes, node.valueBytes)
	}

	// A birth releases the scope's values from the totals.
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(99999))
	if store.valuesTotal != 0 || store.valueBytes != 0 {
		t.Errorf("expected totals back at 0 after a birth, got %d values, %d bytes", store.valuesTotal, store.valueBytes)
	}
}

func TestValueIndexIsCappedByBytes(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	// 1 KB names: the byte cap binds long before the count caps.
	long := strings.Repeat("x", 1024)
	for n := 0; n < 200; n++ {
		info := TopicInfo{Group: "G", Type: MessageTypeNData, EdgeNode: fmt.Sprintf("N%d", n)}
		metrics := []testMetric{}
		for m := 0; m < 400; m++ {
			metrics = append(metrics, testMetric{name: fmt.Sprintf("%s-%d", long, m), doubleValue: f64(1)})
		}
		store.HandleMessage(info, buildPayload(t, descriptor, -1, metrics...), at(int64(n)))
	}
	if store.valueBytes > maxValueBytesTotal {
		t.Errorf("expected value bytes capped at %d, got %d", maxValueBytesTotal, store.valueBytes)
	}
}

func TestAliasTableIsCapped(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	metrics := []testMetric{}
	for i := 0; i < maxMetricsPerScope+500; i++ {
		metrics = append(metrics, testMetric{name: fmt.Sprintf("M%d", i), alias: u64(uint64(i))})
	}
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, metrics...), at(1))
	if n := len(store.nodes[nodeKey{"G", "N"}].Aliases); n != maxMetricsPerScope {
		t.Errorf("expected %d aliases, got %d", maxMetricsPerScope, n)
	}
}

func TestDevicesAreCappedAcrossTheConnection(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	store.devicesTotal = maxTrackedDevicesTotal // as if the connection were full
	meta := store.HandleMessage(TopicInfo{Group: "G", Type: MessageTypeDData, EdgeNode: "N", Device: "D"},
		buildPayload(t, descriptor, -1, testMetric{alias: u64(1), doubleValue: f64(1)}), at(1))
	if meta != nil {
		t.Errorf("expected no meta for a device past the connection cap, got %v", meta)
	}
}

func TestDDeathEndsTheDeviceSession(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(1))
	store.HandleMessage(dbirthInfo, buildPayload(t, descriptor, 1, testMetric{name: "Old", alias: u64(1)}), at(2))
	store.HandleMessage(ddeathInfo, buildPayload(t, descriptor, 2), at(3))

	// The device must DBIRTH again, possibly with different aliases, before
	// its data can be named.
	data := buildPayload(t, descriptor, 3, testMetric{alias: u64(1), doubleValue: f64(1)})
	meta := store.HandleMessage(ddataInfo, data, at(4))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected unresolved after DDEATH, got %v", meta["resolution"])
	}
}

func TestClearHistoryKeepsTheNodesAliases(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts", alias: u64(3)}), at(1))
	store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(1)}), at(2))
	store.HandleMessage(TopicInfo{Type: MessageTypeState, HostID: "h"}, nil, at(3))
	store.ClearHistory()

	replay := store.Replay()
	if len(replay.Refs) != 0 || len(replay.Data) != 0 {
		t.Errorf("expected nothing to replay after a history clear, got %d refs, %d data", len(replay.Refs), len(replay.Data))
	}
	if store.valuesTotal != 0 || store.valueBytes != 0 {
		t.Errorf("expected the value index emptied, got %d, %d", store.valuesTotal, store.valueBytes)
	}
	// Clearing messages doesn't change what the node's aliases mean.
	data := buildPayload(t, descriptor, 2, testMetric{alias: u64(3), doubleValue: f64(2)})
	meta := store.HandleMessage(ndataInfo, data, at(4))
	if meta["resolution"] != ResolutionResolved {
		t.Errorf("expected names to keep resolving after a history clear, got %v", meta["resolution"])
	}
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected seq tracking to carry on, got %v", meta["seqGap"])
	}
}

func TestResyncSeqForgetsALateBaseline(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), at(1))
	store.Suspend()
	// A pre-drop message delivered after Suspend re-seeds the counter...
	store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 5), at(2))
	// ...until the connection comes back up.
	store.ResyncSeq()
	meta := store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 90), at(3))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no gap against a pre-drop baseline, got %v", meta["seqGap"])
	}
}

func TestSuspendRecordsItsOrder(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	birth := handled(store, nbirthInfo, buildPayload(t, descriptor, 0), at(1))
	store.Suspend()
	if replay := store.Replay(); replay.SuspendedOrd != birth.Ord {
		t.Errorf("expected the drop recorded at ord %d, got %d", birth.Ord, replay.SuspendedOrd)
	}
}

func TestResetClearsTheReplay(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "M", alias: u64(1)}), at(1))
	store.HandleMessage(TopicInfo{Type: MessageTypeState, HostID: "scada"}, nil, at(2))
	store.Reset()
	if replay := store.Replay(); len(replay.Refs) != 0 || len(replay.Data) != 0 {
		t.Errorf("expected nothing after reset, got %+v", replay)
	}
}
