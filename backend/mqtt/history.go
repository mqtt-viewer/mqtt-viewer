package mqtt

import (
	"fmt"
	"strings"
	"sync"
)

// DefaultMemoryBudgetBytes bounds the in-RAM message history per connection.
// Older messages are evicted (oldest-first, globally across topics) once the
// estimated retained bytes exceed this budget, so subscribing long-term no
// longer grows memory without limit. Durable/deep history is handled
// separately by opt-in disk recording.
const DefaultMemoryBudgetBytes int64 = 512 * 1024 * 1024 // 512 MB

// latestBudgetShare divides the budget to cap the newest-per-topic cache: it
// may hold at most budget/latestBudgetShare. That cache keeps a topic's current
// value after its messages age out of the recent window, so it grows with topic
// cardinality rather than message volume, and before this cap it sat entirely
// outside the budget (measured ~430 B of heap per distinct topic; at 200k
// topics real heap reached 5x a 16 MB budget). A quarter leaves most of the
// budget for the message timeline while still holding tens of thousands of
// topic values at typical payload sizes.
const latestBudgetShare = 4

// latestBudgetFloorBytes stops the share from rounding down to less than one
// message at very small budgets. Capped at half the budget so the total stays
// within it. Never binding in production: the settings minimum is 64 MB, whose
// quarter share is 16 MB.
const latestBudgetFloorBytes int64 = 1024 * 1024

// MessageHistory is a bounded, in-memory store of recently received messages.
// Everything it retains is charged against the budget, so total bytes never
// exceed it.
//
//   - recent: every retained message in global insertion order. The live slice
//     is recent[head:]; head advances on eviction so we don't reslice on every
//     drop. Oldest is at recent[head].
//   - latest: the newest message per topic, kept even after it falls out of
//     the recent window, so selecting a topic in the tree usually shows at
//     least its current value. Capped at a share of the budget; past that the
//     least recently updated topics lose their pinned value.
type MessageHistory struct {
	mutex       sync.Mutex
	recent      []*MqttMessage
	head        int
	latest      map[string]*MqttMessage
	totalBytes  int64
	budgetBytes int64
	// latestExtraBytes tracks the bytes of newest-per-topic messages that have
	// been evicted from the recent window but are still pinned by the latest
	// map. Bounded by latestBudgetLocked and included in TotalBytes.
	latestExtraBytes int64
	// pinned holds those same messages in the order they were pinned, which is
	// arrival order, so the cache evicts least-recently-updated first. The live
	// slice is pinned[pinnedHead:]. Entries go stale when their topic publishes
	// again; they are skipped on pop and cleared by compaction, which is why
	// pinnedLive (the number of non-stale entries) is tracked separately.
	pinned     []*MqttMessage
	pinnedHead int
	pinnedLive int
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

// TotalBytes returns the estimated bytes of message history currently held in
// memory: the recent window plus the newest-per-topic messages pinned after
// eviction. Both are charged against the budget, so this never exceeds it.
func (m *MessageHistory) TotalBytes() int64 {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	return m.totalBytes + m.latestExtraBytes
}

// Clear empties the store but preserves the configured budget.
func (m *MessageHistory) Clear() {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	m.recent = m.recent[:0]
	m.head = 0
	m.latest = make(map[string]*MqttMessage)
	m.totalBytes = 0
	m.latestExtraBytes = 0
	m.pinned = nil
	m.pinnedHead = 0
	m.pinnedLive = 0
}

func (m *MessageHistory) addMessageToHistory(message MqttMessage) {
	msg := message
	m.mutex.Lock()
	defer m.mutex.Unlock()
	p := &msg
	if prev, ok := m.latest[p.Topic]; ok && prev.evictedFromRecent {
		// The previous latest was pinned outside the recent window; it is now
		// released, so stop counting it. Its queue entry is left to be skipped
		// on pop or dropped by compaction.
		m.latestExtraBytes -= int64(prev.estimatedBytes())
		m.pinnedLive--
	}
	m.latest[p.Topic] = p
	m.recent = append(m.recent, p)
	m.totalBytes += int64(p.estimatedBytes())
	m.evictLocked()
}

// evictLocked drops oldest messages until the retained total (recent window
// plus pinned newest-per-topic messages) is under budget. Caller holds mutex.
//
// Evicting from the recent window can pin a message instead of freeing it, when
// it is still its topic's newest, so the pinned cache is trimmed on every
// iteration: once that cache is at its share of the budget each new pin drops
// an older one, which guarantees the loop makes progress.
func (m *MessageHistory) evictLocked() {
	for m.totalBytes+m.latestExtraBytes > m.budgetBytes && m.head < len(m.recent) {
		old := m.recent[m.head]
		m.recent[m.head] = nil // release for GC
		m.head++
		m.totalBytes -= int64(old.estimatedBytes())
		if m.latest[old.Topic] == old {
			// Still the newest message for its topic, so the latest map pins it
			// in memory; charge it to the pinned cache.
			old.evictedFromRecent = true
			m.latestExtraBytes += int64(old.estimatedBytes())
			m.pinned = append(m.pinned, old)
			m.pinnedLive++
		}
		m.trimPinnedLocked()
	}
	// A budget reduction can leave the pinned cache over its share even when no
	// recent eviction was needed.
	m.trimPinnedLocked()
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
	m.compactPinnedLocked()
}

// latestBudgetLocked is the ceiling on pinned newest-per-topic bytes.
// Caller holds mutex.
func (m *MessageHistory) latestBudgetLocked() int64 {
	return max(m.budgetBytes/latestBudgetShare, min(m.budgetBytes/2, latestBudgetFloorBytes))
}

// trimPinnedLocked drops pinned newest-per-topic messages, least recently
// updated first, until the cache is within its share of the budget. A dropped
// topic leaves the latest map entirely, so selecting it in the tree finds
// nothing until it publishes again. Caller holds mutex.
func (m *MessageHistory) trimPinnedLocked() {
	limit := m.latestBudgetLocked()
	for m.latestExtraBytes > limit && m.pinnedHead < len(m.pinned) {
		oldest := m.pinned[m.pinnedHead]
		m.pinned[m.pinnedHead] = nil // release for GC
		m.pinnedHead++
		if m.latest[oldest.Topic] != oldest || !oldest.evictedFromRecent {
			continue // stale: the topic published again after this was pinned
		}
		delete(m.latest, oldest.Topic)
		m.latestExtraBytes -= int64(oldest.estimatedBytes())
		m.pinnedLive--
	}
}

// compactPinnedLocked rebuilds the pinned queue, dropping both the dead prefix
// the head has consumed and stale entries left behind when a pinned topic
// published again. Without it the backing array grows with message volume
// rather than topic count. Triggered on the same half-consumed rule as the
// recent window, so it stays amortised O(1) per pin, or when stale entries
// outnumber live ones (they can sit mid-queue indefinitely while the cache is
// under its limit). Caller holds mutex.
func (m *MessageHistory) compactPinnedLocked() {
	live := m.pinned[m.pinnedHead:]
	deadPrefix := m.pinnedHead > 0 && m.pinnedHead*2 >= len(m.pinned)
	staleHeavy := len(live) >= 1024 && len(live) > 2*m.pinnedLive
	if !deadPrefix && !staleHeavy {
		return
	}
	n := 0
	for _, p := range live {
		if m.latest[p.Topic] == p && p.evictedFromRecent {
			m.pinned[n] = p
			n++
		}
	}
	for i := n; i < len(m.pinned); i++ {
		m.pinned[i] = nil
	}
	m.pinned = m.pinned[:n]
	m.pinnedHead = 0
}

// GetTopicHistory returns the retained messages for a topic in arrival order.
// If the topic's messages have all aged out of the recent window, its latest
// value is still returned, unless the pinned cache hit its cap and dropped that
// topic too, in which case this errors and callers show an empty timeline.
func (m *MessageHistory) GetTopicHistory(topic string) ([]MqttMessage, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	result := make([]MqttMessage, 0, 16)
	for i := m.head; i < len(m.recent); i++ {
		if m.recent[i].Topic == topic {
			result = append(result, *m.recent[i])
		}
	}
	if len(result) == 0 {
		if latest, ok := m.latest[topic]; ok {
			return []MqttMessage{*latest}, nil
		}
		return nil, fmt.Errorf("topic not found in message history")
	}
	return result, nil
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
