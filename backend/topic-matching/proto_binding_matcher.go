package topicmatching

import (
	"errors"
	"math"
	"strings"
	"sync"

	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/util"
)

const (
	SourceRule      = "rule"
	SourceSparkplug = "sparkplug"

	sparkplugBFilter      = "spBv1.0/#"
	sparkplugAFilter      = "spAv1.0/#"
	sparkplugBMessageType = "SparkplugBPayload"
	sparkplugAMessageType = "SparkplugAPayload"

	maxCacheEntries = 10_000
)

type ProtoBindingMatch struct {
	MessageType string
	Filter      string
	Source      string
}

type ProtoBindingMatcher struct {
	mu    sync.Mutex
	rules []models.ProtoBindingRule
	cache map[string]ProtoBindingMatch
}

func NewProtoBindingMatcher(rules []models.ProtoBindingRule) *ProtoBindingMatcher {
	return &ProtoBindingMatcher{
		rules: rules,
		cache: make(map[string]ProtoBindingMatch),
	}
}

// Match resolves topic against the configured rules plus the implicit
// sparkplug rules, caching the result (including negatives).
func (m *ProtoBindingMatcher) Match(topic string) ProtoBindingMatch {
	m.mu.Lock()
	defer m.mu.Unlock()

	// No user rules: skip the cache entirely and go straight to the
	// sparkplug prefix check, so the sparkplug-only common case stays
	// allocation-free.
	if len(m.rules) == 0 {
		return matchImplicitSparkplugOnly(topic)
	}

	if cached, ok := m.cache[topic]; ok {
		return cached
	}

	result := m.resolve(topic)

	if len(m.cache) >= maxCacheEntries {
		m.cache = make(map[string]ProtoBindingMatch)
	}
	m.cache[topic] = result

	return result
}

// MatchUncached resolves topic without touching the cache, for one-off
// lookups (form previews, publish-time resolution) that shouldn't evict
// hot entries.
func (m *ProtoBindingMatcher) MatchUncached(topic string) ProtoBindingMatch {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.resolve(topic)
}

// SetRules replaces the rule set and clears the cache, since a new rule
// can change the winner for any previously-cached topic.
func (m *ProtoBindingMatcher) SetRules(rules []models.ProtoBindingRule) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rules = rules
	m.cache = make(map[string]ProtoBindingMatch)
}

// candidate is a ranked entry: either a user rule or one of the two
// implicit sparkplug rules.
type candidate struct {
	filter      string
	messageType string
	source      string
	sortOrder   int
	id          uint
	sparkplug   bool
}

var implicitSparkplugCandidates = []candidate{
	{filter: sparkplugBFilter, messageType: sparkplugBMessageType, source: SourceSparkplug, sortOrder: math.MaxInt, sparkplug: true},
	{filter: sparkplugAFilter, messageType: sparkplugAMessageType, source: SourceSparkplug, sortOrder: math.MaxInt, sparkplug: true},
}

func matchImplicitSparkplugOnly(topic string) ProtoBindingMatch {
	if MatchesSparkplugBPrefix(topic) {
		return ProtoBindingMatch{MessageType: sparkplugBMessageType, Filter: sparkplugBFilter, Source: SourceSparkplug}
	}
	if MatchesSparkplugAPrefix(topic) {
		return ProtoBindingMatch{MessageType: sparkplugAMessageType, Filter: sparkplugAFilter, Source: SourceSparkplug}
	}
	return ProtoBindingMatch{}
}

func (m *ProtoBindingMatcher) resolve(topic string) ProtoBindingMatch {
	var best *candidate
	var bestKey specificityKey

	for i := range m.rules {
		r := &m.rules[i]
		c := candidate{filter: r.TopicFilter, messageType: r.MessageType, source: SourceRule, sortOrder: r.SortOrder, id: r.ID}
		if !candidateMatches(c, topic) {
			continue
		}
		key := specificityOf(c)
		if best == nil || key.better(bestKey) {
			cCopy := c
			best = &cCopy
			bestKey = key
		}
	}

	for _, c := range implicitSparkplugCandidates {
		if !candidateMatches(c, topic) {
			continue
		}
		key := specificityOf(c)
		if best == nil || key.better(bestKey) {
			cCopy := c
			best = &cCopy
			bestKey = key
		}
	}

	if best == nil {
		return ProtoBindingMatch{}
	}
	return ProtoBindingMatch{MessageType: best.messageType, Filter: best.filter, Source: best.source}
}

func candidateMatches(c candidate, topic string) bool {
	if c.sparkplug {
		if c.filter == sparkplugBFilter {
			return MatchesSparkplugBPrefix(topic)
		}
		return MatchesSparkplugAPrefix(topic)
	}
	if !util.RouteMatchesTopic(c.filter, topic) {
		return false
	}
	return !violatesDollarGuard(c.filter, topic)
}

// violatesDollarGuard protects $SYS (and other $-prefixed) traffic from
// wildcard-first-segment rules: a filter starting with + or # never
// matches a topic whose first segment starts with $, even though
// util.RouteMatchesTopic (shared with subscription matching) would allow
// it. A filter with an explicit leading $ segment (e.g. "$SYS/#") is
// unaffected.
func violatesDollarGuard(filter, topic string) bool {
	firstFilterSeg := filter
	if idx := strings.IndexByte(filter, '/'); idx >= 0 {
		firstFilterSeg = filter[:idx]
	}
	if firstFilterSeg != "+" && firstFilterSeg != "#" {
		return false
	}
	firstTopicSeg := topic
	if idx := strings.IndexByte(topic, '/'); idx >= 0 {
		firstTopicSeg = topic[:idx]
	}
	return strings.HasPrefix(firstTopicSeg, "$")
}

// specificityKey orders candidates by: literal segment count (desc), no-#
// beats has-# , segment count (desc), SortOrder (asc), ID (asc).
type specificityKey struct {
	literalSegments int
	hasHash         bool
	segmentCount    int
	sortOrder       int
	id              uint
}

func specificityOf(c candidate) specificityKey {
	segments := strings.Split(c.filter, "/")
	literal := 0
	hasHash := false
	for _, seg := range segments {
		switch seg {
		case "#":
			hasHash = true
		case "+":
		default:
			literal++
		}
	}
	return specificityKey{
		literalSegments: literal,
		hasHash:         hasHash,
		segmentCount:    len(segments),
		sortOrder:       c.sortOrder,
		id:              c.id,
	}
}

// better reports whether k should win over other.
func (k specificityKey) better(other specificityKey) bool {
	if k.literalSegments != other.literalSegments {
		return k.literalSegments > other.literalSegments
	}
	if k.hasHash != other.hasHash {
		return !k.hasHash
	}
	if k.segmentCount != other.segmentCount {
		return k.segmentCount > other.segmentCount
	}
	if k.sortOrder != other.sortOrder {
		return k.sortOrder < other.sortOrder
	}
	return k.id < other.id
}

// ValidateTopicFilter checks a proto binding rule's topic filter for the
// MQTT wildcard rules plus binding-specific restrictions (no shared
// subscription filters).
func ValidateTopicFilter(filter string) error {
	if filter == "" {
		return errors.New("topic filter can't be empty")
	}
	if strings.ContainsRune(filter, 0) {
		return errors.New("topic filter can't contain a NUL byte")
	}
	if strings.TrimSpace(filter) != filter {
		return errors.New("topic filter can't have leading or trailing whitespace")
	}
	if strings.HasPrefix(filter, "$share/") {
		return errors.New("shared subscription filters can't be bindings")
	}

	segments := strings.Split(filter, "/")
	for i, seg := range segments {
		if seg == "#" {
			if i != len(segments)-1 {
				return errors.New("'#' must be the last segment")
			}
			continue
		}
		if strings.Contains(seg, "#") {
			return errors.New("'#' must be the last segment")
		}
		if seg == "+" {
			continue
		}
		if strings.Contains(seg, "+") {
			return errors.New("'+' must be a whole segment")
		}
	}

	return nil
}
