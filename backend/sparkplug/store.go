package sparkplug

import (
	"strings"
	"sync"
	"time"

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

// maxTrackedNodes and maxTrackedDevices cap SessionStore growth. A hostile or
// simply broken publisher cycling node/edge or device names would otherwise
// grow these maps without bound for the life of the connection — unlike
// message history, this store never had its own eviction budget.
const (
	maxTrackedNodes   = 4096
	maxTrackedDevices = 1024 // per node
	// maxMetricRefsPerScope bounds the latest-message-per-metric index for one
	// node or device. A birth can declare any number of metrics and an
	// unbirthed publisher can cycle aliases, so both need a ceiling.
	maxMetricRefsPerScope = 4096
	// maxMetricRefsTotal bounds the index across the whole connection, so the
	// per-scope cap times the node and device caps can't add up to gigabytes.
	maxMetricRefsTotal = 1 << 18
	// maxBirthRefsPerNode keeps enough recent NBIRTHs for the frontend to
	// recount a rebirth storm after a replay.
	maxBirthRefsPerNode = 8
	// maxSeqGapRefs keeps the messages behind the most recent seq-gap
	// warnings, matching the frontend's warning strip cap.
	maxSeqGapRefs = 50
	// maxTrackedHosts caps STATE host tracking for the same reason as nodes.
	maxTrackedHosts = 256
)

// MessageRef identifies a message in the connection's history: enough for
// GetMessagesByIds to find it again with a time-hinted lookup.
type MessageRef struct {
	Topic  string
	ID     string
	TimeMs int64
}

type nodeKey struct {
	group    string
	edgeNode string
}

// scopeState is what a node and a device have in common: an alias space, the
// birth that established it, and the index of which message last carried
// each metric (used to replay the tree without replaying every message).
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
	metricRefs map[string]MessageRef
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
// but are flagged as unverified until the node births again. Reset (history
// cleared) drops everything. Safe for concurrent use: HandleMessage runs on
// the receive goroutine while suspends and resets come from others.
type SessionStore struct {
	mu            sync.Mutex
	nodes         map[nodeKey]*nodeState
	hosts         map[string]MessageRef
	seqGapRefs    []MessageRef
	metricRefsLen int
}

func NewSessionStore() *SessionStore {
	return &SessionStore{nodes: map[nodeKey]*nodeState{}, hosts: map[string]MessageRef{}}
}

// Reset drops all session state (births, aliases, seq, replay index).
func (s *SessionStore) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nodes = map[nodeKey]*nodeState{}
	s.hosts = map[string]MessageRef{}
	s.seqGapRefs = nil
	s.metricRefsLen = 0
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
	for _, node := range s.nodes {
		node.verified = false
		node.LastSeq = -1
		node.BdSeq = nil
		for _, device := range node.Devices {
			device.verified = false
		}
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

	if info.Type == MessageTypeState {
		if _, ok := s.hosts[info.HostID]; ok || len(s.hosts) < maxTrackedHosts {
			s.hosts[info.HostID] = ref
		}
		return map[string]any{"msgType": string(info.Type), "hostId": info.HostID}
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
		device = node.ensureDevice(info.Device)
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
		// the old device aliases may already be reassigned.
		for _, d := range node.Devices {
			s.clearScope(&d.scopeState)
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
		s.indexMetrics(scope, msg, ref)

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

// birthScope replaces a scope's aliases and replay index with the birth's.
func (s *SessionStore) birthScope(scope *scopeState, msg *dynamicpb.Message, ref MessageRef) {
	s.clearScope(scope)
	scope.BirthAt = time.UnixMilli(ref.TimeMs)
	scope.hasBirth = true
	scope.verified = true
	scope.Aliases = buildAliasMap(msg)
	birthRef := ref
	scope.birthRef = &birthRef
	scope.deathRef = nil
}

// clearScope forgets a scope's session: aliases, birth, and the metric values
// that belonged to it.
func (s *SessionStore) clearScope(scope *scopeState) {
	s.metricRefsLen -= len(scope.metricRefs)
	scope.metricRefs = nil
	scope.Aliases = map[uint64]string{}
	scope.BirthAt = time.Time{}
	scope.hasBirth = false
	scope.verified = false
	scope.birthRef = nil
}

// indexMetrics records ref as the latest message carrying each of msg's
// metrics. Called after name injection, so a resolved metric is keyed by its
// name (matching the birth's key) and an unresolved one by its alias.
func (s *SessionStore) indexMetrics(scope *scopeState, msg *dynamicpb.Message, ref MessageRef) {
	list, ok := metricsList(msg)
	if !ok {
		return
	}
	for i := 0; i < list.Len(); i++ {
		metric := list.Get(i).Message()
		key := metricName(metric)
		if key == "" {
			alias, hasAlias := metricAlias(metric)
			if !hasAlias {
				continue
			}
			key = aliasKey(alias)
		}
		if _, exists := scope.metricRefs[key]; !exists {
			if len(scope.metricRefs) >= maxMetricRefsPerScope || s.metricRefsLen >= maxMetricRefsTotal {
				continue
			}
			if scope.metricRefs == nil {
				scope.metricRefs = map[string]MessageRef{}
			}
			s.metricRefsLen++
		}
		scope.metricRefs[key] = ref
	}
}

// aliasKey keys an unresolved metric in the replay index. The leading '#'
// cannot collide with a birth-named metric in practice, and even if a name
// did start with it the worst case is replaying one extra message.
func aliasKey(alias uint64) string {
	var buf [21]byte
	i := len(buf)
	for {
		i--
		buf[i] = byte('0' + alias%10)
		alias /= 10
		if alias == 0 {
			break
		}
	}
	i--
	buf[i] = '#'
	return string(buf[i:])
}

// ReplayRefs returns the messages a Sparkplug view needs to rebuild the
// current tree: for every node and device its latest birth and death and the
// latest message carrying each metric, the recent NBIRTHs behind rebirth-storm
// detection, the messages behind recent seq-gap warnings, and each host's
// latest STATE. Deduplicated by id, in no particular order.
func (s *SessionStore) ReplayRefs() []MessageRef {
	s.mu.Lock()
	defer s.mu.Unlock()
	seen := map[string]bool{}
	refs := []MessageRef{}
	add := func(ref MessageRef) {
		if seen[ref.ID] {
			return
		}
		seen[ref.ID] = true
		refs = append(refs, ref)
	}
	addScope := func(scope *scopeState) {
		if scope.birthRef != nil {
			add(*scope.birthRef)
		}
		if scope.deathRef != nil {
			add(*scope.deathRef)
		}
		for _, ref := range scope.metricRefs {
			add(ref)
		}
	}
	for _, node := range s.nodes {
		addScope(&node.scopeState)
		for _, ref := range node.birthRefs {
			add(ref)
		}
		for _, device := range node.Devices {
			addScope(&device.scopeState)
		}
	}
	for _, ref := range s.seqGapRefs {
		add(ref)
	}
	for _, ref := range s.hosts {
		add(ref)
	}
	return refs
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

// ensureDevice returns nil, without inserting, if name is new and the node
// is already at maxTrackedDevices. Callers must tolerate a nil device.
func (n *nodeState) ensureDevice(name string) *deviceState {
	if device, ok := n.Devices[name]; ok {
		return device
	}
	if len(n.Devices) >= maxTrackedDevices {
		return nil
	}
	device := &deviceState{scopeState: scopeState{Aliases: map[uint64]string{}}}
	n.Devices[name] = device
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
