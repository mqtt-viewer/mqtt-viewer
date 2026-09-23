package sparkplug

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// Resolution outcomes for data messages, surfaced in the sparkplug meta map.
const (
	ResolutionNames      = "names"      // no metric needed resolution
	ResolutionResolved   = "resolved"   // every alias-only metric got a name
	ResolutionPartial    = "partial"    // some got names, some didn't
	ResolutionUnresolved = "unresolved" // none resolved (e.g. no birth seen)
)

// Caps on SessionStore growth. A hostile or simply broken publisher cycling
// node, device, alias or metric names would otherwise grow these maps without
// bound for the life of the connection, and unlike message history this store
// has no eviction budget of its own.
const (
	maxTrackedNodes        = 4096
	maxTrackedDevices      = 1024 // per node
	maxTrackedDevicesTotal = 1 << 16
	// maxMetricsPerScope bounds a node's or device's alias table and its
	// latest-value index. Generous: a large PLC can publish thousands of tags.
	maxMetricsPerScope = 16384
	// maxValuesTotal and maxValueBytesTotal bound the latest-value index
	// across the whole connection, by count and by bytes held.
	maxValuesTotal     = 1 << 18
	maxValueBytesTotal = 64 << 20
	// maxBirthRefsPerNode keeps enough recent NBIRTHs for the frontend to
	// recount a rebirth storm after a replay.
	maxBirthRefsPerNode = 8
	// maxSeqGapRefs keeps the messages behind the most recent seq-gap
	// warnings, matching the frontend's warning strip cap.
	maxSeqGapRefs = 50
	// maxTrackedHosts caps STATE host tracking for the same reason as nodes.
	maxTrackedHosts = 256
	// valueOverheadBytes approximates a latest-value entry's map slot, struct
	// and ref beyond its key and encoded metric.
	valueOverheadBytes = 96
	// maxIndexedValueBytes is the largest metric the value index keeps whole.
	// A bigger one (a long string, a file, a big dataset) is indexed without
	// its value, so one camera snapshot can't take the budget of thousands of
	// ordinary metrics. The replay marks it as omitted.
	maxIndexedValueBytes = 256 << 10
	// maxAliasesTotal and maxAliasBytesTotal bound the alias tables across
	// the connection, which otherwise only have a per-scope cap.
	maxAliasesTotal    = 1 << 18
	maxAliasBytesTotal = 32 << 20
	aliasOverheadBytes = 96
	// maxStoredBytesTotal bounds the birth and death payloads kept for the
	// replay. Past it a birth is left to history, as before this store kept
	// them.
	maxStoredBytesTotal = 32 << 20
)

// MessageRef identifies a message in the connection's history: enough for
// GetMessagesByIds to find it again with a time-hinted lookup. Ord is the
// store's arrival counter, a total order over every Sparkplug message on the
// connection (times tie within a millisecond; this never does).
type MessageRef struct {
	Topic  string
	ID     string
	TimeMs int64
	Ord    uint64
	// Retained is set when the broker delivered the message from its
	// retained store, on subscribe: old news, however recent it looks.
	Retained bool
}

// storedMessage is a birth or death kept for the replay. Births and deaths are
// the edge nodes' session state: the replay needs the current ones however
// long ago they arrived, and history is free to evict a quiet node's birth
// under topic churn. raw is the payload re-encoded (births carry no injected
// names); inHistory means it was over maxStoredBytesTotal and the replay
// fetches it from history by ref instead.
type storedMessage struct {
	ref       MessageRef
	raw       []byte
	meta      map[string]any
	inHistory bool
}

// metricValue is the latest value of one metric: the Metric submessage as it
// arrived (with its birth name injected when it was resolved), re-encoded, and
// where it came from. Held here rather than as a reference into history
// because Sparkplug reports by exception: a metric that last changed an hour
// ago lives in an hour-old message, and history is free to evict that.
type metricValue struct {
	raw   []byte
	named bool
	ref   MessageRef
	// omitted is the encoded size of a value too big to index
	// (maxIndexedValueBytes); raw then holds the metric without its value.
	omitted int
}

type nodeKey struct {
	group    string
	edgeNode string
}

// scopeState is what a node and a device have in common: an alias space, the
// birth that established it, and the latest value of each metric (used to
// replay the tree without replaying every message).
type scopeState struct {
	Aliases    map[uint64]string
	aliasBytes int
	BirthAt    time.Time
	hasBirth   bool
	// verified is false when the aliases were carried over a connection drop
	// or came from a retained birth: the edge node may have rebirthed with
	// new aliases while this client wasn't watching, so names resolved from
	// them are shown as unverified until the next live birth.
	verified   bool
	birth      *storedMessage
	death      *storedMessage
	values     map[string]*metricValue
	valueBytes int
}

type deviceState struct {
	scopeState
}

type nodeState struct {
	scopeState
	BdSeq *uint64 // nil until an NBIRTH in this session carried one
	// lastBdSeq is the bdSeq of the newest birth seen, kept across a drop so
	// a retained will from an older session can still be recognised.
	lastBdSeq *uint64
	LastSeq   int16 // -1 until a seq has been observed
	Devices   map[string]*deviceState
	birthRefs []MessageRef // recent NBIRTHs, oldest first
	// lastOrd is the arrival order of the node's newest message (its devices'
	// included), for evicting the least recently heard node at the cap.
	lastOrd uint64
}

// SessionStore tracks Sparkplug B birth/alias state for one connection.
// Aliases belong to the edge node's session, not to this client's MQTT
// session, so a connection drop only Suspends the store: names keep resolving
// but are flagged as unverified until the node births again. Clearing history
// drops what the replay needs from history but keeps the aliases, which are
// the edge nodes' state, not ours. Safe for concurrent use: HandleMessage
// runs on the receive goroutine while suspends and clears come from others.
type SessionStore struct {
	mu           sync.Mutex
	nodes        map[nodeKey]*nodeState
	hosts        map[string]MessageRef
	seqGapRefs   []MessageRef
	devicesTotal int
	valuesTotal  int
	valueBytes   int
	aliasesTotal int
	aliasBytes   int
	storedBytes  int
	// ord counts every Sparkplug message handled, in arrival order.
	ord uint64
	// suspendedOrd is ord at the last Suspend: anything at or below it was
	// received before the most recent connection drop.
	suspendedOrd uint64
	// Descriptors captured from the first decoded payload, to rebuild
	// payloads from stored values on replay.
	payloadDesc protoreflect.MessageDescriptor
}

func NewSessionStore() *SessionStore {
	return &SessionStore{nodes: map[nodeKey]*nodeState{}, hosts: map[string]MessageRef{}}
}

// Reset drops all session state (births, aliases, seq, replay index). The
// arrival counter keeps counting so orders stay comparable across a reset.
func (s *SessionStore) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nodes = map[nodeKey]*nodeState{}
	s.hosts = map[string]MessageRef{}
	s.seqGapRefs = nil
	s.devicesTotal = 0
	s.valuesTotal = 0
	s.valueBytes = 0
	s.aliasesTotal = 0
	s.aliasBytes = 0
	s.storedBytes = 0
	s.suspendedOrd = 0
}

// SuspendedOrd is the arrival order at the most recent connection drop.
// Messages at or below it were received before the drop, including any the
// client still delivers after reconnecting.
func (s *SessionStore) SuspendedOrd() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.suspendedOrd
}

// ClearHistory forgets the traffic the user asked to clear: latest data
// values, warnings, recent NBIRTHs and host STATE. The session state stays:
// aliases, seq, bdSeq and each scope's current birth and death, because they
// are the edge nodes' state, not the history's, and without them every name
// would turn back into an alias and every type be lost until each node
// happened to rebirth.
func (s *SessionStore) ClearHistory() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, node := range s.nodes {
		s.forgetHistory(&node.scopeState)
		node.birthRefs = nil
		for _, device := range node.Devices {
			s.forgetHistory(&device.scopeState)
		}
	}
	s.hosts = map[string]MessageRef{}
	s.seqGapRefs = nil
}

func (s *SessionStore) forgetHistory(scope *scopeState) {
	s.clearValues(scope)
	// A birth or death only kept as a history ref is gone with the history.
	if scope.birth != nil && scope.birth.inHistory {
		scope.birth = nil
	}
	if scope.death != nil && scope.death.inHistory {
		scope.death = nil
	}
}

// Suspend marks every alias table as carried over a connection drop. Messages
// the client missed while away can include a rebirth, so from here on names
// resolved from these aliases are flagged unverified, and the seq counter and
// bdSeq are forgotten (the next seq can't be judged against one from before
// the gap, and a death's bdSeq may belong to a birth this client never saw).
// Everything else survives so the tree and replay stay intact.
func (s *SessionStore) Suspend() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.suspendedOrd = s.ord
	for _, node := range s.nodes {
		node.verified = false
		node.LastSeq = -1
		// lastBdSeq stays, for recognising a retained will once reconnected.
		node.BdSeq = nil
		for _, device := range node.Devices {
			device.verified = false
		}
	}
}

// ResyncSeq forgets every node's seq counter. Called when the connection
// comes back up: paho can still deliver a message from before the drop after
// Suspend has run, and that late message must not become the baseline the
// first post-reconnect message is judged against.
func (s *SessionStore) ResyncSeq() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, node := range s.nodes {
		node.LastSeq = -1
	}
}

// HandleMessage updates session state for a parsed Sparkplug message and
// returns the meta map to attach to middleware properties. msg is the
// already-unmarshalled payload for protobuf types (nil for STATE, and
// tolerated nil for empty NDEATH payloads); for data messages it is mutated
// in place to inject birth-established metric names. ref identifies the
// message in history for replay. Returns nil when the message belongs to a
// node or device the store refused to track (see maxTrackedNodes), so the
// frontend never builds tree state for something we can't follow.
func (s *SessionStore) HandleMessage(info TopicInfo, msg *dynamicpb.Message, ref MessageRef) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ord++
	ref.Ord = s.ord
	if msg != nil && s.payloadDesc == nil {
		s.payloadDesc = msg.Descriptor()
	}

	if info.Type == MessageTypeState {
		if _, ok := s.hosts[info.HostID]; ok || len(s.hosts) < maxTrackedHosts {
			s.hosts[info.HostID] = ref
		}
		return map[string]any{"msgType": string(info.Type), "hostId": info.HostID, "n": ref.Ord}
	}

	// Resolve node state before building any meta so a node rejected by the
	// tracking cap produces no meta at all. NCMD/DCMD deliberately stay out of
	// this list: a command is addressed to a node, not evidence of one, so it
	// must never create an entry.
	var node *nodeState
	switch info.Type {
	case MessageTypeNBirth, MessageTypeDBirth, MessageTypeNData,
		MessageTypeDData, MessageTypeNDeath, MessageTypeDDeath:
		node = s.ensureNode(info)
		if node == nil {
			return nil
		}
		node.lastOrd = ref.Ord
	}

	// A retained message was stored by the broker at some unknown time and
	// replayed on subscribe. Its seq says nothing about the live counter.
	trackSeqIfLive := func(meta map[string]any) {
		if ref.Retained {
			node.LastSeq = -1
			return
		}
		trackSeq(node, msg, meta)
	}

	var device *deviceState
	switch info.Type {
	case MessageTypeDBirth, MessageTypeDData, MessageTypeDDeath:
		device = s.ensureDevice(node, info.Device)
		if device == nil {
			// All messages from an edge node share one seq counter, so a
			// device past the cap still advances it. It just gets no meta.
			trackSeqIfLive(map[string]any{})
			return nil
		}
	}

	meta := map[string]any{
		"msgType":  string(info.Type),
		"group":    info.Group,
		"edgeNode": info.EdgeNode,
		// The frontend orders by this rather than by time: messages in the
		// same millisecond are routine during a node's connect burst.
		"n": ref.Ord,
	}
	if info.Device != "" {
		meta["device"] = info.Device
	}
	if ref.Retained {
		meta["retained"] = true
	}

	// The birth or death this message becomes, kept for the replay with the
	// meta built below.
	var kept *storedMessage

	switch info.Type {
	case MessageTypeNBirth:
		// Flush + rebuild, never merge: stale mappings resolve silently to
		// wrong names.
		kept = s.birthScope(&node.scopeState, msg, ref)
		// Every device's session ends with its node's: Sparkplug requires a
		// fresh DBIRTH for each device after an NBIRTH, and until one arrives
		// the old device aliases may already be reassigned. The device's
		// birth and death stay, so a replay still shows it exists (as
		// awaiting a birth), the same as the live tree does.
		for _, d := range node.Devices {
			s.endSession(&d.scopeState)
		}
		var bdSeq *uint64
		if v, ok := findBdSeq(msg); ok {
			bdSeq = &v
			meta["bdSeq"] = v
		}
		node.lastBdSeq = bdSeq
		if ref.Retained {
			// A retained birth (the spec forbids them, some stacks do it so
			// late joiners get names) is the best name source there is, but
			// not a live one: no storm count, no seq baseline, no bdSeq to
			// judge the next death by, and names unverified.
			node.LastSeq = -1
			node.BdSeq = nil
			break
		}
		node.birthRefs = append(node.birthRefs, ref)
		if len(node.birthRefs) > maxBirthRefsPerNode {
			node.birthRefs = node.birthRefs[1:]
		}
		// An NBIRTH restarts the sequence at 0. Anything else is a publisher
		// bug worth reporting, but adopt it anyway so every following message
		// isn't flagged against a counter the publisher isn't using.
		if seq, ok := payloadSeq(msg); ok {
			got := int16(seq % 256)
			if got != 0 {
				meta["seqGap"] = map[string]any{"expected": 0, "got": int(got)}
			}
			node.LastSeq = got
		} else {
			node.LastSeq = -1
		}
		// A birth without a bdSeq must not inherit the previous session's,
		// or that session's number would be used to reject the next death.
		node.BdSeq = bdSeq

	case MessageTypeDBirth:
		kept = s.birthScope(&device.scopeState, msg, ref)
		trackSeqIfLive(meta)

	case MessageTypeNData, MessageTypeDData:
		trackSeqIfLive(meta)

		scope := &node.scopeState
		if device != nil {
			scope = &device.scopeState
		}
		needed, resolved := resolveMetricNames(msg, scope.Aliases)
		switch {
		case needed == 0:
			meta["resolution"] = ResolutionNames
		case resolved == needed:
			meta["resolution"] = ResolutionResolved
		case resolved > 0:
			meta["resolution"] = ResolutionPartial
		default:
			meta["resolution"] = ResolutionUnresolved
		}
		if resolved > 0 && scope.hasBirth {
			meta["birthAtMs"] = scope.BirthAt.UnixMilli()
			if !scope.verified {
				meta["carriedOver"] = true
			}
		}
		s.indexValues(scope, msg, ref)

	case MessageTypeNDeath:
		// The broker delivers NDEATH as the will, often with a nil payload.
		// NDEATH is the one edge-node message that doesn't consume the seq
		// counter, so no trackSeq here.
		deathBdSeq, hasDeathBdSeq := findBdSeq(msg)
		if hasDeathBdSeq {
			meta["bdSeq"] = deathBdSeq
		}
		// A will from a previous session, replayed after the node has already
		// rebirthed, would blank a node that is plainly still publishing.
		// Live, that shows as a bdSeq mismatch with this session's birth. A
		// retained will is judged against the newest birth seen at all, since
		// it can arrive just after a reconnect, when this session's bdSeq is
		// not confirmed yet.
		expected := node.BdSeq
		if expected == nil && ref.Retained {
			expected = node.lastBdSeq
		}
		if expected != nil && hasDeathBdSeq && *expected != deathBdSeq {
			meta["staleDeath"] = true
			break
		}
		// LastSeq survives: the next NBIRTH is what resets it. Metric values
		// survive too: the tree keeps showing a dead node's last values.
		kept = s.keepMessage(&node.death, msg, ref)
		node.hasBirth = false
		node.verified = false
		s.setAliases(&node.scopeState, map[uint64]string{}, 0)
		node.BirthAt = time.Time{}
		for _, d := range node.Devices {
			d.hasBirth = false
			d.verified = false
			s.setAliases(&d.scopeState, map[uint64]string{}, 0)
			d.BirthAt = time.Time{}
		}

	case MessageTypeDDeath:
		trackSeqIfLive(meta)
		kept = s.keepMessage(&device.death, msg, ref)
		// A dead device must DBIRTH again before its data means anything, and
		// that birth may assign different aliases. Its last values stay.
		device.hasBirth = false
		device.verified = false
		s.setAliases(&device.scopeState, map[uint64]string{}, 0)
		device.BirthAt = time.Time{}

	case MessageTypeNCmd, MessageTypeDCmd:
		// Passthrough: commands don't alter session state.
	}

	if kept != nil {
		kept.meta = meta
	}
	if _, ok := meta["seqGap"]; ok {
		s.seqGapRefs = append(s.seqGapRefs, ref)
		if len(s.seqGapRefs) > maxSeqGapRefs {
			s.seqGapRefs = s.seqGapRefs[1:]
		}
	}
	return meta
}

// birthScope replaces a scope's aliases and latest values with the birth's,
// and keeps the birth for the replay.
func (s *SessionStore) birthScope(scope *scopeState, msg *dynamicpb.Message, ref MessageRef) *storedMessage {
	s.endSession(scope)
	scope.BirthAt = time.UnixMilli(ref.TimeMs)
	scope.hasBirth = true
	scope.verified = !ref.Retained
	aliases, bytes := buildAliasMap(msg, maxAliasesTotal-s.aliasesTotal, maxAliasBytesTotal-s.aliasBytes)
	s.setAliases(scope, aliases, bytes)
	s.dropStored(&scope.death)
	return s.keepMessage(&scope.birth, msg, ref)
}

// endSession forgets a scope's session: its aliases, its birth, and the
// metric values that belonged to it. The stored birth and death are left for
// the caller to decide.
func (s *SessionStore) endSession(scope *scopeState) {
	s.clearValues(scope)
	s.setAliases(scope, map[uint64]string{}, 0)
	scope.BirthAt = time.Time{}
	scope.hasBirth = false
	scope.verified = false
}

func (s *SessionStore) clearValues(scope *scopeState) {
	s.valuesTotal -= len(scope.values)
	s.valueBytes -= scope.valueBytes
	scope.values = nil
	scope.valueBytes = 0
}

// setAliases swaps a scope's alias table, keeping the connection-wide totals.
func (s *SessionStore) setAliases(scope *scopeState, aliases map[uint64]string, bytes int) {
	s.aliasesTotal += len(aliases) - len(scope.Aliases)
	s.aliasBytes += bytes - scope.aliasBytes
	scope.Aliases = aliases
	scope.aliasBytes = bytes
}

// keepMessage stores msg in *slot for the replay, replacing what was there.
// Past maxStoredBytesTotal only the ref is kept, and the replay falls back to
// history for it.
func (s *SessionStore) keepMessage(slot **storedMessage, msg *dynamicpb.Message, ref MessageRef) *storedMessage {
	s.dropStored(slot)
	kept := &storedMessage{ref: ref}
	if msg != nil {
		raw, err := (proto.MarshalOptions{AllowPartial: true}).Marshal(msg)
		switch {
		case err != nil:
			kept.inHistory = true
		case s.storedBytes+len(raw) > maxStoredBytesTotal:
			kept.inHistory = true
		default:
			kept.raw = raw
			s.storedBytes += len(raw)
		}
	}
	*slot = kept
	return kept
}

func (s *SessionStore) dropStored(slot **storedMessage) {
	if *slot != nil {
		s.storedBytes -= len((*slot).raw)
		*slot = nil
	}
}

// indexValues records each of msg's metrics as that metric's latest value.
// Called after name injection, so a resolved metric is keyed by its name
// (matching the birth's key) and an unresolved one by its alias. Repeated
// samples of one metric in a payload leave the last one.
func (s *SessionStore) indexValues(scope *scopeState, msg *dynamicpb.Message, ref MessageRef) {
	list, ok := metricsList(msg)
	if !ok {
		return
	}
	for i := 0; i < list.Len(); i++ {
		metric := list.Get(i).Message()
		key := metricName(metric)
		named := key != ""
		if !named {
			alias, hasAlias := metricAlias(metric)
			if !hasAlias {
				continue
			}
			key = aliasKey(alias)
		}
		// Sparkplug B has no required fields; skip the walk that checks them.
		raw, err := (proto.MarshalOptions{AllowPartial: true}).Marshal(metric.Interface())
		if err != nil {
			continue
		}
		omitted := 0
		if len(raw) > maxIndexedValueBytes {
			omitted = len(raw)
			if raw, err = marshalWithoutValue(metric); err != nil {
				continue
			}
		}
		existing, exists := scope.values[key]
		size := len(key) + len(raw) + valueOverheadBytes
		if exists {
			old := len(key) + len(existing.raw) + valueOverheadBytes
			if s.valueBytes-old+size > maxValueBytesTotal {
				// Keeping the old value would replay it as current forever.
				delete(scope.values, key)
				s.valuesTotal--
				s.valueBytes -= old
				scope.valueBytes -= old
				continue
			}
			s.valueBytes += size - old
			scope.valueBytes += size - old
			existing.raw, existing.named, existing.ref, existing.omitted = raw, named, ref, omitted
			continue
		}
		if len(scope.values) >= maxMetricsPerScope || s.valuesTotal >= maxValuesTotal ||
			s.valueBytes+size > maxValueBytesTotal {
			continue
		}
		if scope.values == nil {
			scope.values = map[string]*metricValue{}
		}
		scope.values[key] = &metricValue{raw: raw, named: named, ref: ref, omitted: omitted}
		s.valuesTotal++
		s.valueBytes += size
		scope.valueBytes += size
	}
}

// valueFields are the Metric fields that carry its value.
var valueFields = []protoreflect.Name{
	"int_value", "long_value", "float_value", "double_value", "boolean_value",
	"string_value", "bytes_value", "dataset_value", "template_value", "extension_value",
}

// marshalWithoutValue encodes a metric with its value fields cleared: its
// name, alias, datatype and timestamp, for a value too big to index.
func marshalWithoutValue(metric protoreflect.Message) ([]byte, error) {
	stub := proto.Clone(metric.Interface()).ProtoReflect()
	fields := stub.Descriptor().Fields()
	for _, name := range valueFields {
		if fd := fields.ByName(name); fd != nil {
			stub.Clear(fd)
		}
	}
	return (proto.MarshalOptions{AllowPartial: true}).Marshal(stub.Interface())
}

// aliasKey keys an unresolved metric in the value index. The leading '#'
// cannot collide with a birth-named metric in practice, and even if a name
// did start with it the worst case is one metric shadowing another's value.
func aliasKey(alias uint64) string {
	return "#" + strconv.FormatUint(alias, 10)
}

// ReplayData is one message of the replay: a kept birth or death, or a
// data message rebuilt from the latest values that all came from the same
// original message. Payload is nil only for a message that had none.
type ReplayData struct {
	Topic   string
	ID      string
	TimeMs  int64
	Ord     uint64
	Payload *dynamicpb.Message
	Meta    map[string]any
}

// Replay is what a Sparkplug view needs to rebuild the current tree. Data
// holds every scope's current birth and death and the latest value of every
// metric, all from the store itself. Refs are messages to fetch from history:
// older NBIRTHs for rebirth-storm counts, the messages behind recent seq-gap
// warnings, each host's latest STATE, and any birth or death too big to
// keep. SuspendedOrd is the arrival order of the last connection drop, so a
// view created later still knows which births predate it.
type Replay struct {
	Refs         []MessageRef
	Data         []ReplayData
	SuspendedOrd uint64
}

// replayScope is one scope's share of a replay, copied out under the lock so
// the payloads can be rebuilt without holding it.
type replayScope struct {
	key      nodeKey
	device   string
	values   []metricValue
	hasBirth bool
	verified bool
	birthAt  time.Time
}

// Replay snapshots the store for a Sparkplug view. Refs are deduplicated by
// id; nothing is in a particular order (the caller sorts by Ord). Only the
// copying happens under the lock: rebuilding payloads for a full index takes
// hundreds of milliseconds, and the receive goroutine needs the lock for
// every message.
func (s *SessionStore) Replay() Replay {
	s.mu.Lock()
	out := Replay{SuspendedOrd: s.suspendedOrd}
	desc := s.payloadDesc
	var stored []storedMessage
	var scopes []replayScope
	seen := map[string]bool{}
	add := func(ref MessageRef) {
		if seen[ref.ID] {
			return
		}
		seen[ref.ID] = true
		out.Refs = append(out.Refs, ref)
	}
	keep := func(m *storedMessage) {
		if m == nil {
			return
		}
		if m.inHistory {
			add(m.ref)
			return
		}
		seen[m.ref.ID] = true
		stored = append(stored, *m)
	}
	addScope := func(scope *scopeState, key nodeKey, device string) {
		keep(scope.birth)
		keep(scope.death)
		if len(scope.values) == 0 {
			return
		}
		rs := replayScope{key: key, device: device, hasBirth: scope.hasBirth, verified: scope.verified, birthAt: scope.BirthAt}
		rs.values = make([]metricValue, 0, len(scope.values))
		for _, v := range scope.values {
			rs.values = append(rs.values, *v)
		}
		scopes = append(scopes, rs)
	}
	for key, node := range s.nodes {
		addScope(&node.scopeState, key, "")
		for name, device := range node.Devices {
			addScope(&device.scopeState, key, name)
		}
	}
	for _, node := range s.nodes {
		for _, ref := range node.birthRefs {
			add(ref)
		}
	}
	for _, ref := range s.seqGapRefs {
		add(ref)
	}
	for _, ref := range s.hosts {
		add(ref)
	}
	s.mu.Unlock()

	if desc == nil {
		return out
	}
	for _, m := range stored {
		payload := dynamicpb.NewMessage(desc)
		if err := (proto.UnmarshalOptions{AllowPartial: true}).Unmarshal(m.raw, payload); err != nil {
			continue
		}
		out.Data = append(out.Data, ReplayData{
			Topic:   m.ref.Topic,
			ID:      m.ref.ID,
			TimeMs:  m.ref.TimeMs,
			Ord:     m.ref.Ord,
			Payload: payload,
			Meta:    m.meta,
		})
	}
	for _, rs := range scopes {
		out.Data = append(out.Data, replayValues(desc, rs)...)
	}
	return out
}

// replayValues groups a scope's latest values by the message they came from
// and rebuilds one data message per group.
func replayValues(desc protoreflect.MessageDescriptor, rs replayScope) []ReplayData {
	metricsField := desc.Fields().ByName("metrics")
	if metricsField == nil {
		return nil
	}
	type group struct {
		ref     MessageRef
		values  []metricValue
		named   int
		omitted map[string]int
	}
	groups := map[uint64]*group{}
	for _, v := range rs.values {
		g, ok := groups[v.ref.Ord]
		if !ok {
			g = &group{ref: v.ref}
			groups[v.ref.Ord] = g
		}
		g.values = append(g.values, v)
		if v.named {
			g.named++
		}
	}
	msgType := MessageTypeNData
	if rs.device != "" {
		msgType = MessageTypeDData
	}
	out := make([]ReplayData, 0, len(groups))
	for _, g := range groups {
		payload := dynamicpb.NewMessage(desc)
		list := payload.Mutable(metricsField).List()
		for _, v := range g.values {
			metric := list.NewElement()
			if err := (proto.UnmarshalOptions{AllowPartial: true}).Unmarshal(v.raw, metric.Message().Interface()); err != nil {
				continue
			}
			list.Append(metric)
			if v.omitted > 0 {
				if g.omitted == nil {
					g.omitted = map[string]int{}
				}
				g.omitted[frontendMetricKey(metric.Message())] = v.omitted
			}
		}
		meta := map[string]any{
			"msgType":  string(msgType),
			"group":    rs.key.group,
			"edgeNode": rs.key.edgeNode,
			"n":        g.ref.Ord,
			"replayed": true,
		}
		if rs.device != "" {
			meta["device"] = rs.device
		}
		if g.omitted != nil {
			// Values too big to index: the view shows their size and sends
			// you to the message for the value.
			meta["omitted"] = g.omitted
		}
		switch {
		case g.named == len(g.values):
			meta["resolution"] = ResolutionResolved
		case g.named > 0:
			meta["resolution"] = ResolutionPartial
		default:
			meta["resolution"] = ResolutionUnresolved
		}
		if g.named > 0 && rs.hasBirth {
			meta["birthAtMs"] = rs.birthAt.UnixMilli()
			if !rs.verified {
				meta["carriedOver"] = true
			}
		}
		out = append(out, ReplayData{
			Topic:   g.ref.Topic,
			ID:      g.ref.ID,
			TimeMs:  g.ref.TimeMs,
			Ord:     g.ref.Ord,
			Payload: payload,
			Meta:    meta,
		})
	}
	return out
}

// frontendMetricKey is how the frontend keys a metric: its name, or
// "alias_<n>" for one still unnamed.
func frontendMetricKey(metric protoreflect.Message) string {
	if name := metricName(metric); name != "" {
		return name
	}
	alias, _ := metricAlias(metric)
	return "alias_" + strconv.FormatUint(alias, 10)
}

// trackSeq advances the node's seq counter and records a gap in meta when the
// observed seq is not the expected successor. Every edge-node message except
// NDEATH consumes the node's single shared counter.
func trackSeq(node *nodeState, msg *dynamicpb.Message, meta map[string]any) {
	seq, ok := payloadSeq(msg)
	if !ok {
		return
	}
	got := int16(seq % 256)
	if node.LastSeq >= 0 {
		expected := (node.LastSeq + 1) % 256
		if got != expected {
			meta["seqGap"] = map[string]any{"expected": int(expected), "got": int(got)}
		}
	}
	node.LastSeq = got
}

// ensureNode returns the node for info, creating it. At maxTrackedNodes it
// first evicts the least recently heard node, preferring one whose last word
// was a death, so a connection that churns through ephemeral node ids keeps
// following the live ones. Returns nil only if nothing could be evicted.
func (s *SessionStore) ensureNode(info TopicInfo) *nodeState {
	key := nodeKey{info.Group, info.EdgeNode}
	if node, ok := s.nodes[key]; ok {
		return node
	}
	if len(s.nodes) >= maxTrackedNodes && !s.evictNode() {
		return nil
	}
	node := &nodeState{
		scopeState: scopeState{Aliases: map[uint64]string{}},
		LastSeq:    -1,
		Devices:    map[string]*deviceState{},
	}
	s.nodes[key] = node
	return node
}

// evictNode drops the least recently heard node, dead ones first. A scan,
// but only when a new node arrives at the cap.
func (s *SessionStore) evictNode() bool {
	var victimKey nodeKey
	var victim *nodeState
	victimDead := false
	for key, node := range s.nodes {
		dead := node.death != nil && node.death.ref.Ord == node.lastOrd
		switch {
		case victim == nil,
			dead && !victimDead,
			dead == victimDead && node.lastOrd < victim.lastOrd:
			victimKey, victim, victimDead = key, node, dead
		}
	}
	if victim == nil {
		return false
	}
	s.forgetScope(&victim.scopeState)
	for _, device := range victim.Devices {
		s.forgetScope(&device.scopeState)
	}
	s.devicesTotal -= len(victim.Devices)
	delete(s.nodes, victimKey)
	return true
}

// forgetScope releases everything a scope holds against the connection-wide
// caps.
func (s *SessionStore) forgetScope(scope *scopeState) {
	s.clearValues(scope)
	s.setAliases(scope, map[uint64]string{}, 0)
	s.dropStored(&scope.birth)
	s.dropStored(&scope.death)
}

// ensureDevice returns nil, without inserting, if name is new and either the
// node or the connection is at its device cap. Callers must tolerate a nil
// device.
func (s *SessionStore) ensureDevice(n *nodeState, name string) *deviceState {
	if device, ok := n.Devices[name]; ok {
		return device
	}
	if len(n.Devices) >= maxTrackedDevices || s.devicesTotal >= maxTrackedDevicesTotal {
		return nil
	}
	device := &deviceState{scopeState: scopeState{Aliases: map[uint64]string{}}}
	n.Devices[name] = device
	s.devicesTotal++
	return device
}

// --- dynamic message helpers -------------------------------------------------

func payloadSeq(msg *dynamicpb.Message) (uint64, bool) {
	if msg == nil {
		return 0, false
	}
	fd := msg.Descriptor().Fields().ByName("seq")
	if fd == nil || !msg.Has(fd) {
		return 0, false
	}
	return msg.Get(fd).Uint(), true
}

func metricsList(msg *dynamicpb.Message) (protoreflect.List, bool) {
	if msg == nil {
		return nil, false
	}
	fd := msg.Descriptor().Fields().ByName("metrics")
	if fd == nil || !fd.IsList() || !msg.Has(fd) {
		return nil, false
	}
	return msg.Get(fd).List(), true
}

func metricName(metric protoreflect.Message) string {
	fd := metric.Descriptor().Fields().ByName("name")
	if fd == nil || !metric.Has(fd) {
		return ""
	}
	return metric.Get(fd).String()
}

func metricAlias(metric protoreflect.Message) (uint64, bool) {
	fd := metric.Descriptor().Fields().ByName("alias")
	if fd == nil || !metric.Has(fd) {
		return 0, false
	}
	return metric.Get(fd).Uint(), true
}

// buildAliasMap collects alias->name pairs from a birth payload's metrics,
// at most maxMetricsPerScope of them and no more than the connection-wide
// alias budget left (count and bytes). Returns the map and its accounted
// bytes. Metrics missing either half are skipped (aliases are optional in
// Sparkplug); ones past the budget stay unresolved.
func buildAliasMap(msg *dynamicpb.Message, countLeft, bytesLeft int) (map[uint64]string, int) {
	aliases := map[uint64]string{}
	bytes := 0
	list, ok := metricsList(msg)
	if !ok {
		return aliases, 0
	}
	limit := min(maxMetricsPerScope, countLeft)
	for i := 0; i < list.Len(); i++ {
		metric := list.Get(i).Message()
		name := metricName(metric)
		alias, hasAlias := metricAlias(metric)
		if name == "" || !hasAlias {
			continue
		}
		// proto2 lets Unmarshal through invalid UTF-8 in string fields;
		// protojson.Marshal rejects it later. Sanitise now so an injected
		// name never poisons every subsequent message on this alias.
		name = strings.ToValidUTF8(name, "\uFFFD")
		old, exists := aliases[alias]
		if exists {
			bytes -= len(old) + aliasOverheadBytes
		} else if len(aliases) >= limit {
			continue
		}
		size := len(name) + aliasOverheadBytes
		if bytes+size > bytesLeft {
			if exists {
				delete(aliases, alias)
			}
			continue
		}
		aliases[alias] = name
		bytes += size
	}
	return aliases, bytes
}

// resolveMetricNames injects birth-established names into alias-only metrics,
// mutating the payload in place. Only real names from births are injected —
// placeholders for unresolved aliases are the frontend's job. Returns how
// many metrics needed resolution and how many got a name.
func resolveMetricNames(msg *dynamicpb.Message, aliases map[uint64]string) (needed, resolved int) {
	list, ok := metricsList(msg)
	if !ok {
		return 0, 0
	}
	for i := 0; i < list.Len(); i++ {
		metric := list.Get(i).Message()
		if metricName(metric) != "" {
			continue
		}
		alias, hasAlias := metricAlias(metric)
		if !hasAlias {
			continue
		}
		needed++
		name, ok := aliases[alias]
		if !ok {
			continue
		}
		fd := metric.Descriptor().Fields().ByName("name")
		if fd == nil {
			continue
		}
		metric.Set(fd, protoreflect.ValueOfString(name))
		resolved++
	}
	return needed, resolved
}

// findBdSeq extracts the value of the metric named "bdSeq" from a birth or
// death payload. The spec carries it as an Int64/UInt64 metric (long_value),
// but some stacks emit it as int_value.
func findBdSeq(msg *dynamicpb.Message) (uint64, bool) {
	list, ok := metricsList(msg)
	if !ok {
		return 0, false
	}
	for i := 0; i < list.Len(); i++ {
		metric := list.Get(i).Message()
		if metricName(metric) != "bdSeq" {
			continue
		}
		for _, fieldName := range []protoreflect.Name{"long_value", "int_value"} {
			fd := metric.Descriptor().Fields().ByName(fieldName)
			if fd != nil && metric.Has(fd) {
				return metric.Get(fd).Uint(), true
			}
		}
	}
	return 0, false
}
