package sparkplug

import (
	"fmt"
	"mqtt-viewer/backend/protobuf"
	"strings"
	"testing"
	"time"
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

func u64(v uint64) *uint64   { return &v }
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
)

func TestBirthThenDataResolves(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	birthAt := time.UnixMilli(1000)

	birth := buildPayload(t, descriptor, 0,
		testMetric{name: "Volts/L1", alias: u64(3)},
		testMetric{name: "Amps/L1", alias: u64(5)},
	)
	meta := store.HandleMessage(nbirthInfo, birth, birthAt)
	if meta["msgType"] != "NBIRTH" || meta["group"] != "G" || meta["edgeNode"] != "N" {
		t.Errorf("unexpected birth meta: %+v", meta)
	}

	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(239.9)})
	meta = store.HandleMessage(ndataInfo, data, time.UnixMilli(2000))
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
	meta := store.HandleMessage(ndataInfo, data, time.UnixMilli(1000))
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
	store.HandleMessage(nbirthInfo, firstBirth, time.UnixMilli(1000))

	// The rebirth drops alias 3 entirely — never merge with the old map.
	rebirth := buildPayload(t, descriptor, 0, testMetric{name: "New/Metric", alias: u64(4)})
	store.HandleMessage(nbirthInfo, rebirth, time.UnixMilli(2000))

	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta := store.HandleMessage(ndataInfo, data, time.UnixMilli(3000))
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
	store.HandleMessage(nbirthInfo, nodeBirth, time.UnixMilli(1000))
	deviceBirth := buildPayload(t, descriptor, 1, testMetric{name: "Device/Metric", alias: u64(3)})
	store.HandleMessage(dbirthInfo, deviceBirth, time.UnixMilli(1500))

	ddata := buildPayload(t, descriptor, 2, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta := store.HandleMessage(ddataInfo, ddata, time.UnixMilli(2000))
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
	meta = store.HandleMessage(ndataInfo, ndata, time.UnixMilli(2500))
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

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), time.UnixMilli(1000))

	meta := store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 1), time.UnixMilli(1100))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no gap at seq 1, got %v", meta["seqGap"])
	}

	meta = store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 3), time.UnixMilli(1200))
	gap, ok := meta["seqGap"].(map[string]any)
	if !ok {
		t.Fatalf("expected seqGap at seq 3, got %v", meta["seqGap"])
	}
	if gap["expected"] != 2 || gap["got"] != 3 {
		t.Errorf("expected gap {expected:2 got:3}, got %v", gap)
	}

	// LastSeq must track the received value, so 4 after 3 is clean again.
	meta = store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 4), time.UnixMilli(1300))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no gap at seq 4, got %v", meta["seqGap"])
	}
}

func TestSeqWraparoundIsNotAGap(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 255), time.UnixMilli(1000))

	meta := store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 0), time.UnixMilli(1100))
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected 255->0 wraparound to be clean, got %v", meta["seqGap"])
	}

	meta = store.HandleMessage(ndataInfo, buildPayload(t, descriptor, 2), time.UnixMilli(1200))
	gap, ok := meta["seqGap"].(map[string]any)
	if !ok {
		t.Fatalf("expected gap at seq 2, got %v", meta["seqGap"])
	}
	if gap["expected"] != 1 || gap["got"] != 2 {
		t.Errorf("expected gap {expected:1 got:2}, got %v", gap)
	}
}

func TestNDeathMarksOfflineAndCarriesBdSeq(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	birth := buildPayload(t, descriptor, 0, testMetric{name: "bdSeq", alias: u64(1), longValue: u64(3)})
	meta := store.HandleMessage(nbirthInfo, birth, time.UnixMilli(1000))
	if meta["bdSeq"] != uint64(3) {
		t.Errorf("expected birth bdSeq 3, got %v", meta["bdSeq"])
	}

	death := buildPayload(t, descriptor, -1, testMetric{name: "bdSeq", longValue: u64(3)})
	meta = store.HandleMessage(ndeathInfo, death, time.UnixMilli(2000))
	if meta["bdSeq"] != uint64(3) {
		t.Errorf("expected death bdSeq 3, got %v", meta["bdSeq"])
	}

	node := store.nodes[nodeKey{"G", "N"}]
	if node == nil || node.Online {
		t.Errorf("expected node offline after NDEATH")
	}
}

func TestNilPayloadNDeath(t *testing.T) {
	store := NewSessionStore()
	meta := store.HandleMessage(ndeathInfo, nil, time.UnixMilli(1000))
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

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts/L1", alias: u64(3)}), time.UnixMilli(1000))
	data := buildPayload(t, descriptor, 1, testMetric{name: "Volts/L1", doubleValue: f64(240.0)})
	meta := store.HandleMessage(ndataInfo, data, time.UnixMilli(2000))
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

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts/L1", alias: u64(3)}), time.UnixMilli(1000))
	data := buildPayload(t, descriptor, 1,
		testMetric{alias: u64(3), doubleValue: f64(1.0)},
		testMetric{alias: u64(9), doubleValue: f64(2.0)},
	)
	meta := store.HandleMessage(ndataInfo, data, time.UnixMilli(2000))
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
	meta := store.HandleMessage(info, nil, time.UnixMilli(1000))
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
		store.HandleMessage(info, buildPayload(t, descriptor, 0, testMetric{name: "M", alias: u64(1)}), time.UnixMilli(1000))
	}
	if len(store.nodes) != maxTrackedNodes {
		t.Fatalf("expected %d nodes tracked, got %d", maxTrackedNodes, len(store.nodes))
	}

	// An already-tracked node keeps working past the cap.
	existingBirth := TopicInfo{Group: "G", Type: MessageTypeNBirth, EdgeNode: "N0"}
	store.HandleMessage(existingBirth, buildPayload(t, descriptor, 1, testMetric{name: "Volts/L1", alias: u64(3)}), time.UnixMilli(2000))
	existingData := TopicInfo{Group: "G", Type: MessageTypeNData, EdgeNode: "N0"}
	meta := store.HandleMessage(existingData, buildPayload(t, descriptor, 2, testMetric{alias: u64(3), doubleValue: f64(1.0)}), time.UnixMilli(3000))
	if meta["resolution"] != ResolutionResolved {
		t.Errorf("expected existing node to keep resolving, got %v", meta["resolution"])
	}

	// A brand-new node past the cap passes through instead of panicking.
	newNodeInfo := TopicInfo{Group: "G", Type: MessageTypeNData, EdgeNode: "new-node"}
	data := buildPayload(t, descriptor, 5, testMetric{alias: u64(3), doubleValue: f64(2.0)})
	meta = store.HandleMessage(newNodeInfo, data, time.UnixMilli(4000))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected unresolved resolution for capped node, got %v", meta["resolution"])
	}
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no seqGap tracking for capped node, got %v", meta["seqGap"])
	}
	if len(store.nodes) != maxTrackedNodes {
		t.Errorf("expected node count to stay capped at %d, got %d", maxTrackedNodes, len(store.nodes))
	}
}

func TestSessionStoreCapsDeviceTracking(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()
	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0), time.UnixMilli(1000))

	for i := 0; i < maxTrackedDevices; i++ {
		info := TopicInfo{Group: "G", Type: MessageTypeDBirth, EdgeNode: "N", Device: fmt.Sprintf("D%d", i)}
		store.HandleMessage(info, buildPayload(t, descriptor, 0, testMetric{name: "M", alias: u64(1)}), time.UnixMilli(1000))
	}

	newDeviceInfo := TopicInfo{Group: "G", Type: MessageTypeDData, EdgeNode: "N", Device: "new-device"}
	meta := store.HandleMessage(newDeviceInfo, buildPayload(t, descriptor, 1, testMetric{alias: u64(1), doubleValue: f64(1.0)}), time.UnixMilli(2000))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected unresolved resolution for capped device, got %v", meta["resolution"])
	}

	node := store.nodes[nodeKey{"G", "N"}]
	if node == nil || len(node.Devices) != maxTrackedDevices {
		t.Errorf("expected device count to stay capped at %d", maxTrackedDevices)
	}
}

func TestResetClearsEverything(t *testing.T) {
	descriptor := loadPayloadDescriptor(t)
	store := NewSessionStore()

	store.HandleMessage(nbirthInfo, buildPayload(t, descriptor, 0, testMetric{name: "Volts/L1", alias: u64(3)}), time.UnixMilli(1000))
	store.Reset()

	data := buildPayload(t, descriptor, 1, testMetric{alias: u64(3), doubleValue: f64(1.0)})
	meta := store.HandleMessage(ndataInfo, data, time.UnixMilli(2000))
	if meta["resolution"] != ResolutionUnresolved {
		t.Errorf("expected unresolved after reset, got %v", meta["resolution"])
	}
	if _, ok := meta["seqGap"]; ok {
		t.Errorf("expected no seqGap after reset (LastSeq forgotten), got %v", meta["seqGap"])
	}
}
