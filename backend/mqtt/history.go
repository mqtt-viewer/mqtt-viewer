package mqtt

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

// DefaultMemoryBudgetBytes bounds the in-RAM message history per connection.
// Older messages are evicted (oldest-first, globally across topics) once the
// estimated retained bytes exceed this budget, so subscribing long-term no
// longer grows memory without limit. Durable/deep history is handled
// separately by opt-in disk recording.
const DefaultMemoryBudgetBytes int64 = 512 * 1024 * 1024 // 512 MB

// MessageHistory is a bounded, in-memory store of recently received messages.
//
//   - recent: every retained message in global insertion order. The live slice
//     is recent[head:]; head advances on eviction so we don't reslice on every
//     drop. Oldest is at recent[head].
//   - latest: the newest message per topic, kept even after it falls out of
//     the recent window, so selecting a topic in the tree always shows at least
//     its current value. Bounded by topic cardinality, not message volume.
//   - retained: the topics we currently believe hold a retained message. Like
//     latest, bounded by topic cardinality and never evicted by the byte
//     budget. See the field comment for what it can and cannot tell you.
type MessageHistory struct {
	mutex  sync.Mutex
	recent []*MqttMessage
	head   int
	latest map[string]*MqttMessage
	// retained holds the topics we believe currently have a retained message,
	// maintained from the Retain flag: a retained message with a payload marks
	// its topic, a retained zero-length payload (the MQTT tombstone) unmarks
	// it.
	//
	// This is "retained messages we know about", NOT broker truth. Under MQTT 3
	// the flag is only set on subscribe-time replay, because subscribe.go has no
	// RetainAsPublished equivalent for v3, so a topic another client retains
	// mid-session goes undetected. Callers must not present this as a complete
	// picture of the broker.
	retained    map[string]struct{}
	totalBytes  int64
	budgetBytes int64
}

func newMessageHistory() *MessageHistory {
	return &MessageHistory{
		recent:      make([]*MqttMessage, 0, 1024),
		latest:      make(map[string]*MqttMessage),
		retained:    make(map[string]struct{}),
		budgetBytes: DefaultMemoryBudgetBytes,
	}
}

// SetBudgetBytes adjusts the memory budget and immediately evicts down to it.
// A non-positive value is ignored.
func (m *MessageHistory) SetBudgetBytes(budget int64) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	if budget <= 0 {
		return
	}
	m.budgetBytes = budget
	m.evictLocked()
}

// Clear empties the store but preserves the configured budget.
func (m *MessageHistory) Clear() {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	m.recent = m.recent[:0]
	m.head = 0
	m.latest = make(map[string]*MqttMessage)
	m.retained = make(map[string]struct{})
	m.totalBytes = 0
}

func (m *MessageHistory) addMessageToHistory(message MqttMessage) {
	msg := message
	m.mutex.Lock()
	defer m.mutex.Unlock()
	p := &msg
	m.latest[p.Topic] = p
	m.trackRetainedLocked(p)
	m.recent = append(m.recent, p)
	m.totalBytes += int64(p.estimatedBytes())
	m.evictLocked()
}

// trackRetainedLocked maintains the retained index from a message's Retain
// flag. A retained message with a payload means the topic now holds a retained
// value; a retained zero-length payload is the MQTT tombstone that clears one.
// Non-retained messages say nothing either way and are ignored. Caller holds
// mutex.
func (m *MessageHistory) trackRetainedLocked(msg *MqttMessage) {
	if !msg.Retain {
		return
	}
	if len(msg.Payload) == 0 {
		delete(m.retained, msg.Topic)
		return
	}
	m.retained[msg.Topic] = struct{}{}
}

// evictLocked drops oldest messages until under budget. Caller holds mutex.
func (m *MessageHistory) evictLocked() {
	for m.totalBytes > m.budgetBytes && m.head < len(m.recent) {
		old := m.recent[m.head]
		m.recent[m.head] = nil // release for GC
		m.head++
		m.totalBytes -= int64(old.estimatedBytes())
	}
	// Compact the backing array once head has consumed half of it, so the
	// dead prefix is reclaimed rather than growing unbounded.
	if m.head > 0 && m.head*2 >= len(m.recent) {
		n := copy(m.recent, m.recent[m.head:])
		for i := n; i < len(m.recent); i++ {
			m.recent[i] = nil
		}
		m.recent = m.recent[:n]
		m.head = 0
	}
}

// GetTopicHistory returns every retained message for a topic in arrival
// order. Unbounded: only for paths that genuinely need the full window (e.g.
// export). UI paths must use GetTopicHistoryWindow — copying a busy topic's
// entire history while holding the mutex stalls every concurrent receive.
func (m *MessageHistory) GetTopicHistory(topic string) ([]MqttMessage, error) {
	return m.GetTopicHistoryWindow(topic, 0)
}

// GetTopicHistoryWindow returns up to `limit` of the NEWEST retained messages
// for a topic, in arrival order (limit <= 0 means no limit). The scan runs
// backwards from the newest message and short-circuits once `limit` matches
// are found, so for a busy topic it touches only the tail of the window
// instead of every retained message. If the topic's messages have all aged
// out of the recent window, its latest value is still returned so a
// tree-click is never empty.
func (m *MessageHistory) GetTopicHistoryWindow(topic string, limit int) ([]MqttMessage, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	result := make([]MqttMessage, 0, 16)
	for i := len(m.recent) - 1; i >= m.head; i-- {
		if m.recent[i].Topic == topic {
			result = append(result, *m.recent[i])
			if limit > 0 && len(result) >= limit {
				break
			}
		}
	}
	// collected newest-first; flip to arrival order
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	if len(result) == 0 {
		if latest, ok := m.latest[topic]; ok {
			return []MqttMessage{*latest}, nil
		}
		return nil, fmt.Errorf("topic not found in message history")
	}
	return result, nil
}

// GetTopicTimelineWindow returns up to `limit` of the NEWEST retained
// messages for a topic as lightweight stubs (no payload), in arrival order
// (limit <= 0 means no limit). Mirrors GetTopicHistoryWindow's backwards scan
// so the timeline can render a busy topic's dots without paying to
// serialize its payloads across the bridge.
func (m *MessageHistory) GetTopicTimelineWindow(topic string, limit int) ([]MqttMessageStub, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	result := make([]MqttMessageStub, 0, 16)
	for i := len(m.recent) - 1; i >= m.head; i-- {
		if m.recent[i].Topic == topic {
			result = append(result, m.recent[i].Stub())
			if limit > 0 && len(result) >= limit {
				break
			}
		}
	}
	// collected newest-first; flip to arrival order
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	if len(result) == 0 {
		if latest, ok := m.latest[topic]; ok {
			return []MqttMessageStub{latest.Stub()}, nil
		}
		return nil, fmt.Errorf("topic not found in message history")
	}
	return result, nil
}

// SLACK_MS bounds how far a message's position in `recent` can disagree with
// its TimeMs. Appends run on per-message goroutines (see receiveMessage in
// receive.go), so under load a message can land in the slice a few
// milliseconds before or after its neighbours by receive time. The slice is
// therefore only near-sorted by TimeMs; any time-hinted lookup must widen its
// search window by this slack. 2s is orders of magnitude more than the
// observed reordering while still keeping hinted lookups tiny relative to
// the full window.
const SLACK_MS int64 = 2000

// GetMessageById looks up a single message by id within a topic's retained
// RAM window. When timeMsHint > 0 (the message's receive time, known to the
// caller from its stub) the lookup binary-searches the near-sorted window for
// the [hint-SLACK_MS, hint+SLACK_MS] range and scans only that, O(log n)
// instead of a full scan; a hint older than the window's oldest entry means
// the message was evicted, answered in O(1). timeMsHint <= 0 falls back to
// the original full backwards scan. Returns found=false (no error) when the
// id has aged out of the recent window rather than treating it as a failure,
// so the frontend can render a graceful "no longer available" state.
func (m *MessageHistory) GetMessageById(topic string, id string, timeMsHint int64) (msg MqttMessage, found bool) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	return m.getMessageByIdLocked(topic, id, timeMsHint)
}

// GetMessagesByIds looks up a batch of messages by id within a topic's
// retained RAM window, using the same time-hinted lookup as GetMessageById.
// ids and timesMs are parallel slices; malformed input (length mismatch)
// returns nil. Only the messages actually found are returned, so the caller
// can treat any omitted id as aged out.
func (m *MessageHistory) GetMessagesByIds(topic string, ids []string, timesMs []int64) []MqttMessage {
	if len(ids) != len(timesMs) {
		return nil
	}
	m.mutex.Lock()
	defer m.mutex.Unlock()
	result := make([]MqttMessage, 0, len(ids))
	for i, id := range ids {
		if msg, found := m.getMessageByIdLocked(topic, id, timesMs[i]); found {
			result = append(result, msg)
		}
	}
	return result
}

// GetHistoryByTopicPrefix returns retained messages whose topic starts with
// prefix, in global arrival order, plus the latest value of any matching topic
// whose messages have fully aged out of the recent window. The prefix filter is
// applied inside the lock so hold time and allocation scale with the matching
// volume only, not the whole retained window (unlike GetAllHistory, which copies
// everything). Result is unsorted across topics; callers that need time order
// sort the (much smaller) returned slice.
func (m *MessageHistory) GetHistoryByTopicPrefix(prefix string) []MqttMessage {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	result := []MqttMessage{}
	inWindow := make(map[string]bool)
	for i := m.head; i < len(m.recent); i++ {
		if strings.HasPrefix(m.recent[i].Topic, prefix) {
			result = append(result, *m.recent[i])
			inWindow[m.recent[i].Topic] = true
		}
	}
	for topic, latest := range m.latest {
		if strings.HasPrefix(topic, prefix) && !inWindow[topic] {
			result = append(result, *latest)
		}
	}
	return result
}

// IsRetained reports whether a topic currently holds a retained message, as
// far as we know. See the retained field comment: a false here means "I have
// not seen one", not "the broker has none".
func (m *MessageHistory) IsRetained(topic string) bool {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	_, ok := m.retained[topic]
	return ok
}

// RetainedUnderPrefix returns the known-retained topics at or below prefix, in
// sorted order so a confirmation dialog lists them stably. An empty prefix
// matches every retained topic.
//
// Matching is on topic-level boundaries, not raw string prefix: "a/b" matches
// "a/b" and "a/b/c", but never "a/bc".
func (m *MessageHistory) RetainedUnderPrefix(prefix string) []string {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	result := make([]string, 0, 16)
	for topic := range m.retained {
		if matchesTopicPrefix(topic, prefix) {
			result = append(result, topic)
		}
	}
	sort.Strings(result)
	return result
}

// matchesTopicPrefix reports whether topic is at or below prefix, respecting
// topic-level boundaries so "a/b" does not match "a/bc". An empty prefix
// matches everything.
func matchesTopicPrefix(topic string, prefix string) bool {
	if prefix == "" {
		return true
	}
	return topic == prefix || strings.HasPrefix(topic, prefix+"/")
}

// getMessageByIdLocked implements the per-id lookup. Caller holds mutex.
func (m *MessageHistory) getMessageByIdLocked(topic string, id string, timeMsHint int64) (MqttMessage, bool) {
	live := m.recent[m.head:]
	if timeMsHint > 0 {
		// Fast aged-out check: a hint older than the oldest retained entry
		// (minus slack) means the message was evicted from the window; only
		// the latest-per-topic fallback can still hold it.
		if len(live) > 0 && timeMsHint < live[0].TimeMs-SLACK_MS {
			return m.latestByIdLocked(topic, id)
		}
		lo := sort.Search(len(live), func(i int) bool {
			return live[i].TimeMs >= timeMsHint-SLACK_MS
		})
		hi := sort.Search(len(live), func(i int) bool {
			return live[i].TimeMs > timeMsHint+SLACK_MS
		})
		for i := lo; i < hi; i++ {
			if live[i].Topic == topic && live[i].Id == id {
				return *live[i], true
			}
		}
		return m.latestByIdLocked(topic, id)
	}
	// No hint: full backwards scan (compatibility path).
	for i := len(live) - 1; i >= 0; i-- {
		if live[i].Topic == topic && live[i].Id == id {
			return *live[i], true
		}
	}
	return m.latestByIdLocked(topic, id)
}

// latestByIdLocked checks the latest-per-topic fallback for an exact id
// match. Caller holds mutex.
func (m *MessageHistory) latestByIdLocked(topic string, id string) (MqttMessage, bool) {
	if latest, ok := m.latest[topic]; ok && latest.Id == id {
		return *latest, true
	}
	return MqttMessage{}, false
}

// GetAllHistory returns a per-topic copy of the retained window, including the
// latest value of any topic whose messages have fully aged out.
func (m *MessageHistory) GetAllHistory() map[string][]MqttMessage {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	out := make(map[string][]MqttMessage)
	for i := m.head; i < len(m.recent); i++ {
		msg := *m.recent[i]
		out[msg.Topic] = append(out[msg.Topic], msg)
	}
	for topic, latest := range m.latest {
		if _, ok := out[topic]; !ok {
			out[topic] = []MqttMessage{*latest}
		}
	}
	return out
}
