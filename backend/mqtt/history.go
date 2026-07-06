package mqtt

import (
	"fmt"
	"sort"
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
type MessageHistory struct {
	mutex       sync.Mutex
	recent      []*MqttMessage
	head        int
	latest      map[string]*MqttMessage
	totalBytes  int64
	budgetBytes int64
}

func newMessageHistory() *MessageHistory {
	return &MessageHistory{
		recent:      make([]*MqttMessage, 0, 1024),
		latest:      make(map[string]*MqttMessage),
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
	m.totalBytes = 0
}

func (m *MessageHistory) addMessageToHistory(message MqttMessage) {
	msg := message
	m.mutex.Lock()
	defer m.mutex.Unlock()
	p := &msg
	m.latest[p.Topic] = p
	m.recent = append(m.recent, p)
	m.totalBytes += int64(p.estimatedBytes())
	m.evictLocked()
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
