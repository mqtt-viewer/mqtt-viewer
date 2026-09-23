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
}

type nodeKey struct {
	group    string
	edgeNode string
}

// scopeState is what a node and a device have in common: an alias space, the
// birth that established it, and the latest value of each metric (used to
// replay the tree without replaying every message).
type scopeState struct {
	Aliases  map[uint64]string
	BirthAt  time.Time
	hasBirth bool
	// verified is false when the aliases were carried over a connection drop:
	// the edge node may have rebirthed with new aliases while this client was
	// away, so names resolved from them are shown as unverified until the
	// next birth.
	verified   bool
	birthRef   *MessageRef
	deathRef   *MessageRef
	values     map[string]*metricValue
	valueBytes int
}

type deviceState struct {
	scopeState
}

type nodeState struct {
	scopeState
	BdSeq     *uint64 // nil until an NBIRTH in this session carried one
	LastSeq   int16   // -1 until a seq has been observed
	Devices   map[string]*deviceState
	birthRefs []MessageRef // recent NBIRTHs, oldest first
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
	s.suspendedOrd = 0
}

// ClearHistory forgets everything the replay would fetch from or rebuild out
// of history (births, deaths, latest values, warnings, host STATE), for when
// the user clears the connection's history. Aliases, seq and bdSeq stay: they
// are the edge nodes' session state, and wiping them would turn every name
// back into an alias until each node happened to rebirth.
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
	scope.birthRef = nil
	scope.deathRef = nil
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
	}

	var device *deviceState
	switch info.Type {
	case MessageTypeDBirth, MessageTypeDData, MessageTypeDDeath:
		device = s.ensureDevice(node, info.Device)
		if device == nil {
			// All messages from an edge node share one seq counter, so a
			// device past the cap still advances it. It just gets no meta.
			trackSeq(node, msg, map[string]any{})
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

	switch info.Type {
	case MessageTypeNBirth:
		// Flush + rebuild, never merge: stale mappings resolve silently to
		// wrong names.
		s.birthScope(&node.scopeState, msg, ref)
		// Every device's session ends with its node's: Sparkplug requires a
		// fresh DBIRTH for each device after an NBIRTH, and until one arrives
		// the old device aliases may already be reassigned. The device's
		// birth and death refs stay, so a replay still shows it exists (as
		// awaiting a birth), the same as the live tree does.
		for _, d := range node.Devices {
			s.endSession(&d.scopeState)
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
		node.BdSeq = nil
		if bdSeq, ok := findBdSeq(msg); ok {
			node.BdSeq = &bdSeq
			meta["bdSeq"] = bdSeq
		}

	case MessageTypeDBirth:
		s.birthScope(&device.scopeState, msg, ref)
		trackSeq(node, msg, meta)

	case MessageTypeNData, MessageTypeDData:
		trackSeq(node, msg, meta)

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
		if node.BdSeq != nil && hasDeathBdSeq && *node.BdSeq != deathBdSeq {
			// A retained will from a previous session, replayed after the node
			// has already rebirthed. Killing the live session's aliases here
			// would blank a node that is plainly still publishing.
			meta["staleDeath"] = true
			break
		}
		// LastSeq survives: the next NBIRTH is what resets it. Metric refs
		// survive too: the tree keeps showing a dead node's last values.
		deathRef := ref
		node.deathRef = &deathRef
		node.hasBirth = false
		node.verified = false
		node.Aliases = map[uint64]string{}
		node.BirthAt = time.Time{}
		for _, d := range node.Devices {
			d.hasBirth = false
			d.verified = false
			d.Aliases = map[uint64]string{}
			d.BirthAt = time.Time{}
		}

	case MessageTypeDDeath:
		trackSeq(node, msg, meta)
		deathRef := ref
		device.deathRef = &deathRef
		// A dead device must DBIRTH again before its data means anything, and
		// that birth may assign different aliases. Its last values stay.
		device.hasBirth = false
		device.verified = false
		device.Aliases = map[uint64]string{}
		device.BirthAt = time.Time{}

	case MessageTypeNCmd, MessageTypeDCmd:
		// Passthrough: commands don't alter session state.
	}

	if _, ok := meta["seqGap"]; ok {
		s.seqGapRefs = append(s.seqGapRefs, ref)
		if len(s.seqGapRefs) > maxSeqGapRefs {
			s.seqGapRefs = s.seqGapRefs[1:]
		}
	}
	return meta
}

// birthScope replaces a scope's aliases and latest values with the birth's.
func (s *SessionStore) birthScope(scope *scopeState, msg *dynamicpb.Message, ref MessageRef) {
	s.endSession(scope)
	scope.BirthAt = time.UnixMilli(ref.TimeMs)
	scope.hasBirth = true
	scope.verified = true
	scope.Aliases = buildAliasMap(msg)
	birthRef := ref
	scope.birthRef = &birthRef
	scope.deathRef = nil
}

// endSession forgets a scope's session: its aliases, its birth, and the
// metric values that belonged to it. The birth and death refs are left for
// the caller to decide.
func (s *SessionStore) endSession(scope *scopeState) {
	s.clearValues(scope)
	scope.Aliases = map[uint64]string{}
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

// indexValues records each of msg's metrics as that metric's latest value.
// Called after name injection, so a resolved metric is keyed by its name
// (matching the birth's key) and an unresolved one by its alias.
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
		existing, exists := scope.values[key]
		size := len(key) + len(raw) + valueOverheadBytes
		if exists {
			old := len(key) + len(existing.raw) + valueOverheadBytes
			if s.valueBytes-old+size > maxValueBytesTotal {
				continue
			}
			s.valueBytes += size - old
			scope.valueBytes += size - old
			existing.raw, existing.named, existing.ref = raw, named, ref
			continue
		}
		if len(scope.values) >= maxMetricsPerScope || s.valuesTotal >= maxValuesTotal ||
			s.valueBytes+size > maxValueBytesTotal {
			continue
		}
		if scope.values == nil {
			scope.values = map[string]*metricValue{}
		}
		scope.values[key] = &metricValue{raw: raw, named: named, ref: ref}
		s.valuesTotal++
		s.valueBytes += size
		scope.valueBytes += size
	}
}

// aliasKey keys an unresolved metric in the value index. The leading '#'
// cannot collide with a birth-named metric in practice, and even if a name
// did start with it the worst case is one metric shadowing another's value.
func aliasKey(alias uint64) string {
	return "#" + strconv.FormatUint(alias, 10)
}

// ReplayData is one rebuilt data message: the latest values that all came
// from the same original message, re-encoded as a payload.
type ReplayData struct {
	Topic   string
	ID      string
	TimeMs  int64
	Ord     uint64
	Payload *dynamicpb.Message
	Meta    map[string]any
}

// Replay is what a Sparkplug view needs to rebuild the current tree: Refs
// are messages to fetch from history (every scope's latest birth and death,
// recent NBIRTHs for rebirth-storm counts, the messages behind recent seq-gap
// warnings, and each host's latest STATE), Data rebuilds the latest value of
// every metric from the store itself. SuspendedOrd is the arrival order of the
// last connection drop, so a view created later still knows which births
// predate it.
type Replay struct {
	Refs         []MessageRef
	Data         []ReplayData
	SuspendedOrd uint64
}

// Replay snapshots the store for a Sparkplug view. Refs are deduplicated by
// id; nothing is in a particular order (the caller sorts by Ord).
func (s *SessionStore) Replay() Replay {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Replay{SuspendedOrd: s.suspendedOrd}
	seen := map[string]bool{}
	add := func(ref MessageRef) {
		if seen[ref.ID] {
			return
		}
		seen[ref.ID] = true
		out.Refs = append(out.Refs, ref)
	}
	addScope := func(scope *scopeState, key nodeKey, device string) {
		if scope.birthRef != nil {
			add(*scope.birthRef)
		}
		if scope.deathRef != nil {
			add(*scope.deathRef)
		}
		out.Data = append(out.Data, s.replayValues(scope, key, device)...)
	}
	for key, node := range s.nodes {
		addScope(&node.scopeState, key, "")
		for _, ref := range node.birthRefs {
			add(ref)
		}
		for name, device := range node.Devices {
			addScope(&device.scopeState, key, name)
		}
	}
	for _, ref := range s.seqGapRefs {
		add(ref)
	}
	for _, ref := range s.hosts {
		add(ref)
	}
	return out
}

// replayValues groups a scope's latest values by the message they came from
// and rebuilds one data message per group. Caller holds mu.
func (s *SessionStore) replayValues(scope *scopeState, key nodeKey, device string) []ReplayData {
	if len(scope.values) == 0 || s.payloadDesc == nil {
		return nil
	}
	metricsField := s.payloadDesc.Fields().ByName("metrics")
	if metricsField == nil {
		return nil
	}
	type group struct {
		ref   MessageRef
		raws  [][]byte
		named int
	}
	groups := map[uint64]*group{}
	for _, v := range scope.values {
		g, ok := groups[v.ref.Ord]
		if !ok {
			g = &group{ref: v.ref}
			groups[v.ref.Ord] = g
		}
		g.raws = append(g.raws, v.raw)
		if v.named {
			g.named++
		}
	}
	msgType := MessageTypeNData
	if device != "" {
		msgType = MessageTypeDData
	}
	out := make([]ReplayData, 0, len(groups))
	for _, g := range groups {
		payload := dynamicpb.NewMessage(s.payloadDesc)
		list := payload.Mutable(metricsField).List()
		for _, raw := range g.raws {
			metric := list.NewElement()
			if err := (proto.UnmarshalOptions{AllowPartial: true}).Unmarshal(raw, metric.Message().Interface()); err != nil {
				continue
			}
			list.Append(metric)
		}
		meta := map[string]any{
			"msgType":  string(msgType),
			"group":    key.group,
			"edgeNode": key.edgeNode,
			"n":        g.ref.Ord,
			"replayed": true,
		}
		if device != "" {
			meta["device"] = device
		}
		switch {
		case g.named == len(g.raws):
			meta["resolution"] = ResolutionResolved
		case g.named > 0:
			meta["resolution"] = ResolutionPartial
		default:
			meta["resolution"] = ResolutionUnresolved
		}
		if g.named > 0 && scope.hasBirth {
			meta["birthAtMs"] = scope.BirthAt.UnixMilli()
			if !scope.verified {
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

// ensureNode returns nil, without inserting, if key is new and the store is
// already at maxTrackedNodes. Callers must tolerate a nil node.
func (s *SessionStore) ensureNode(info TopicInfo) *nodeState {
	key := nodeKey{info.Group, info.EdgeNode}
	if node, ok := s.nodes[key]; ok {
		return node
	}
	if len(s.nodes) >= maxTrackedNodes {
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

// buildAliasMap collects alias->name pairs from a birth payload's metrics.
// Metrics missing either half are skipped (aliases are optional in Sparkplug).
func buildAliasMap(msg *dynamicpb.Message) map[uint64]string {
	aliases := map[uint64]string{}
	list, ok := metricsList(msg)
	if !ok {
		return aliases
	}
	for i := 0; i < list.Len(); i++ {
		metric := list.Get(i).Message()
		name := metricName(metric)
		alias, hasAlias := metricAlias(metric)
		if name != "" && hasAlias {
			if _, exists := aliases[alias]; !exists && len(aliases) >= maxMetricsPerScope {
				continue
			}
			// proto2 lets Unmarshal through invalid UTF-8 in string fields;
			// protojson.Marshal rejects it later. Sanitise now so an injected
			// name never poisons every subsequent message on this alias.
			aliases[alias] = strings.ToValidUTF8(name, "�")
		}
	}
	return aliases
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
