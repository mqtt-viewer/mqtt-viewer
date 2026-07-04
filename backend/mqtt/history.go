package mqtt

import (
	"fmt"
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
