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
)

type nodeKey struct {
	group    string
	edgeNode string
}

type deviceState struct {
	Online   bool
	Aliases  map[uint64]string // DEVICE alias space, separate from the node's
	BirthAt  time.Time
	hasBirth bool
}

type nodeState struct {
	Online   bool
	BdSeq    uint64
	hasBdSeq bool
	LastSeq  int16             // -1 until a seq has been observed
	Aliases  map[uint64]string // NODE alias space only
	Devices  map[string]*deviceState
	BirthAt  time.Time
	hasBirth bool
}

// SessionStore tracks Sparkplug B birth/alias state for one connection.
// Aliases are only valid for the life of the MQTT session, so the store is
// Reset on disconnect and when history is cleared. Safe for concurrent use:
// HandleMessage runs on the receive goroutine while resets come from others.
type SessionStore struct {
	mu    sync.Mutex
	nodes map[nodeKey]*nodeState
}

func NewSessionStore() *SessionStore {
	return &SessionStore{nodes: map[nodeKey]*nodeState{}}
}

// Reset drops all session state (births, aliases, seq counters).
func (s *SessionStore) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nodes = map[nodeKey]*nodeState{}
}

// HandleMessage updates session state for a parsed Sparkplug message and
// returns the meta map to attach to middleware properties. msg is the
// already-unmarshalled payload for protobuf types (nil for STATE, and
// tolerated nil for empty NDEATH payloads); for data messages it is mutated
// in place to inject birth-established metric names.
func (s *SessionStore) HandleMessage(info TopicInfo, msg *dynamicpb.Message, arrival time.Time) map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()

	meta := map[string]any{"msgType": string(info.Type)}
	if info.Type == MessageTypeState {
		meta["hostId"] = info.HostID
		return meta
	}
	meta["group"] = info.Group
	meta["edgeNode"] = info.EdgeNode
	if info.Device != "" {
		meta["device"] = info.Device
	}

	switch info.Type {
	case MessageTypeNBirth:
		node := s.ensureNode(info)
		if node == nil {
			// At the tracking cap for a node we've never seen — passthrough,
			// no alias/seq state to keep.
			break
		}
		node.Online = true
		node.BirthAt = arrival
		node.hasBirth = true
		// Flush + rebuild, never merge — stale mappings resolve silently to
		// wrong names.
		node.Aliases = buildAliasMap(msg)
		if seq, ok := payloadSeq(msg); ok {
			node.LastSeq = int16(seq % 256)
		} else {
			node.LastSeq = -1
		}
		if bdSeq, ok := findBdSeq(msg); ok {
			node.BdSeq = bdSeq
			node.hasBdSeq = true
			meta["bdSeq"] = bdSeq
		}

	case MessageTypeDBirth:
		node := s.ensureNode(info)
		if node == nil {
			break
		}
		if device := node.ensureDevice(info.Device); device != nil {
			device.Online = true
			device.BirthAt = arrival
			device.hasBirth = true
			device.Aliases = buildAliasMap(msg)
		}
		// All messages from an edge node share one seq counter, so a DBIRTH
		// advances the node's seq too — independent of the device cap above.
		if seq, ok := payloadSeq(msg); ok {
			node.LastSeq = int16(seq % 256)
		}

	case MessageTypeNData, MessageTypeDData:
		node := s.ensureNode(info)
		if node != nil {
			if seq, ok := payloadSeq(msg); ok {
				got := int16(seq % 256)
				if node.LastSeq >= 0 {
					expected := (node.LastSeq + 1) % 256
					if got != expected {
						meta["seqGap"] = map[string]any{"expected": int(expected), "got": int(got)}
					}
				}
				node.LastSeq = got
			}
		}

		// A capped (nil) node has no aliases or birth on record, so this
		// falls through to the same "unresolved" path as data before birth.
		var aliases map[uint64]string
		var birthAt time.Time
		var hasBirth bool
		if node != nil {
			aliases, birthAt, hasBirth = node.Aliases, node.BirthAt, node.hasBirth
			if info.Type == MessageTypeDData {
				aliases, birthAt, hasBirth = nil, time.Time{}, false
				if device, ok := node.Devices[info.Device]; ok {
					aliases, birthAt, hasBirth = device.Aliases, device.BirthAt, device.hasBirth
				}
			}
		}
		needed, resolved := resolveMetricNames(msg, aliases)
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
		if resolved > 0 && hasBirth {
			meta["birthAtMs"] = birthAt.UnixMilli()
		}

	case MessageTypeNDeath:
		// The broker delivers NDEATH as the will, often with a nil payload.
		if node := s.ensureNode(info); node != nil {
			node.Online = false
			for _, device := range node.Devices {
				device.Online = false
			}
		}
		if bdSeq, ok := findBdSeq(msg); ok {
			meta["bdSeq"] = bdSeq
		}

	case MessageTypeDDeath:
		if node, ok := s.nodes[nodeKey{info.Group, info.EdgeNode}]; ok {
			if device, ok := node.Devices[info.Device]; ok {
				device.Online = false
			}
		}

	case MessageTypeNCmd, MessageTypeDCmd:
		// Passthrough — commands don't alter session state.
	}
	return meta
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
		LastSeq: -1,
		Aliases: map[uint64]string{},
		Devices: map[string]*deviceState{},
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
	device := &deviceState{Aliases: map[uint64]string{}}
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
