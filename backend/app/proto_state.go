package app

import (
	"sync"

	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"

	"google.golang.org/protobuf/reflect/protoreflect"
)

// protoState is the per-connection live protobuf state: whether decode/encode
// is switched on, the compiled per-connection registry (nil until a proto
// folder has been picked and loaded), and the topic-to-type matcher. The
// matcher is never nil (even before any registry is loaded) so topic
// matching and the implicit sparkplug rules always work; whether a match
// actually decodes depends on whether a registry is loaded.
//
// Registry compiles happen outside protoState's lock (protobuf.LoadProtoRegistry
// walks the filesystem and can be slow); only the pointer swap is protected.
// It implements mqttmiddleware.ProtoResolver.
type protoState struct {
	mu         sync.Mutex
	enabled    bool
	registry   *protobuf.ProtoRegistry
	matcher    *topicmatching.ProtoBindingMatcher
	loadError  string
	loadedDir  string
	dirMissing bool
}

func newProtoState(enabled bool, rules []models.ProtoBindingRule) *protoState {
	return &protoState{
		enabled: enabled,
		matcher: topicmatching.NewProtoBindingMatcher(rules),
	}
}

func (s *protoState) IsEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.enabled
}

func (s *protoState) SetEnabled(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.enabled = enabled
}

// Match resolves topic against the live binding matcher (cached). The
// matcher has its own internal lock and is never swapped out, so this can
// run without holding protoState's mutex.
func (s *protoState) Match(topic string) topicmatching.ProtoBindingMatch {
	return s.matcher.Match(topic)
}

// MatchUncached resolves topic without touching the matcher's hot cache, for
// one-off lookups (form previews, publish-time resolution).
func (s *protoState) MatchUncached(topic string) topicmatching.ProtoBindingMatch {
	return s.matcher.MatchUncached(topic)
}

// SetRules replaces the live matcher's rule set (and clears its cache).
func (s *protoState) SetRules(rules []models.ProtoBindingRule) {
	s.matcher.SetRules(rules)
}

// RuleDescriptor resolves a message type name against the per-connection
// registry, for Source=="rule" matches. Returns false if no registry is
// loaded or the name isn't found in it.
func (s *protoState) RuleDescriptor(name string) (protoreflect.MessageDescriptor, bool) {
	s.mu.Lock()
	registry := s.registry
	s.mu.Unlock()
	if registry == nil {
		return nil, false
	}
	return registry.GetMessageDescriptorFromName(name)
}

// Registry returns the currently loaded per-connection registry, or nil.
func (s *protoState) Registry() *protobuf.ProtoRegistry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.registry
}

// NeedsLoad reports whether dir requires a fresh compile attempt: no attempt
// (success or failure) has yet been recorded for this exact directory.
func (s *protoState) NeedsLoad(dir string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return dir != "" && (s.loadedDir != dir || s.loadError != "")
}

// SetRegistry records the outcome of a compile attempt: reg is the freshly
// compiled registry (nil on failure or when clearing), dir is the directory
// it was compiled from, and loadErr is the compile error string (empty on
// success). Compile itself must happen outside this call; this only swaps
// the pointer and records the outcome.
func (s *protoState) SetRegistry(reg *protobuf.ProtoRegistry, dir string, loadErr string, dirMissing bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.registry = reg
	s.loadedDir = dir
	s.loadError = loadErr
	s.dirMissing = dirMissing
}

// Clear drops any loaded registry and load outcome, for when the proto
// folder is unset on a connection.
func (s *protoState) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.registry = nil
	s.loadedDir = ""
	s.loadError = ""
	s.dirMissing = false
}

// protoStateSnapshot is a consistent point-in-time read of protoState, used
// to build ProtoStateResult without holding the lock while doing further work.
type protoStateSnapshot struct {
	enabled    bool
	registry   *protobuf.ProtoRegistry
	loadError  string
	loadedDir  string
	dirMissing bool
}

func (s *protoState) snapshot() protoStateSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return protoStateSnapshot{
		enabled:    s.enabled,
		registry:   s.registry,
		loadError:  s.loadError,
		loadedDir:  s.loadedDir,
		dirMissing: s.dirMissing,
	}
}
