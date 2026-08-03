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

// latestBudgetDivisor caps the share of the memory budget the latest-per-topic
// map may hold: 1/4, leaving 3/4 for the recent window.
//
// The two stores compete for the same budget but serve different things:
// `recent` gives back-scroll depth on the selected topic, `latest` gives
// breadth (a last value for every topic in the tree, however quiet). A pinned
// latest entry is always older than every message still in `recent` — its
// newest message is what aged out — so a plain oldest-first policy would drop
// the entire latest map before touching a single recent message, and clicking
// a quiet topic would go blank the moment the connection went over budget.
// Reserving a share for `latest` keeps that breadth while still bounding it.
const latestBudgetDivisor = 4

// latestEntryOverhead approximates the non-message heap cost of one
// latest-map entry: the map bucket slot and key header (~35 B at Go's load
// factor) plus the latestEntry struct itself (48 B). The topic string's bytes
// are shared with the message's Topic field, so they are not counted twice.
const latestEntryOverhead = 96

// latestEntry is the latest-per-topic slot for one topic.
//
// While the entry's message is still inside the recent window it is unpinned
// and costs nothing extra: those bytes are already charged to recentBytes.
// Once the message is evicted from `recent` the entry becomes the only thing
// keeping it alive, so it is pinned, charged to latestBytes, and linked into
// the LRU list so it can be dropped under budget pressure.
type latestEntry struct {
	msg        *MqttMessage
	topic      string
	pinned     bool
	prev, next *latestEntry
}

// MessageHistory is a bounded, in-memory store of recently received messages.
//
//   - recent: every retained message in global insertion order. The live slice
//     is recent[head:]; head advances on eviction so we don't reslice on every
//     drop. Oldest is at recent[head].
//   - latest: the newest message per topic, kept even after it falls out of
//     the recent window, so selecting a topic in the tree normally shows at
//     least its current value. Bounded by its share of the memory budget:
//     on a broker with hundreds of thousands of topics the least recently
//     updated topics are dropped from it (see latestBudgetDivisor).
//
// Every retained message is charged exactly once: to recentBytes while it is
// in the recent window, then to latestBytes if the latest map pins it after
// eviction. recentBytes + latestBytes is what the budget bounds.
type MessageHistory struct {
	mutex       sync.Mutex
	recent      []*MqttMessage
	head        int
	latest      map[string]*latestEntry
	recentBytes int64
	latestBytes int64
	budgetBytes int64
	// lruOldest/lruNewest bound the list of pinned latest entries, ordered by
	// when each topic last received a message: lruOldest is the least recently
	// updated topic and the first to be dropped. Unpinned entries are not
	// listed; their topics are all newer than every pinned one, because a
	// topic pins exactly when its newest message leaves the recent window.
	lruOldest *latestEntry
	lruNewest *latestEntry
	// droppedTopics counts latest entries discarded under budget pressure.
	droppedTopics int64
}

func newMessageHistory() *MessageHistory {
	return &MessageHistory{
		recent:      make([]*MqttMessage, 0, 1024),
		latest:      make(map[string]*latestEntry),
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
// memory: the recent window plus the newest-per-topic messages pinned outside
// it. This is the figure the budget bounds, so the settings readout and the
// budget describe the same thing.
func (m *MessageHistory) TotalBytes() int64 {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	return m.recentBytes + m.latestBytes
}

// Clear empties the store but preserves the configured budget.
func (m *MessageHistory) Clear() {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	m.recent = m.recent[:0]
	m.head = 0
	m.latest = make(map[string]*latestEntry)
	m.recentBytes = 0
	m.latestBytes = 0
	m.lruOldest = nil
	m.lruNewest = nil
}

func (m *MessageHistory) addMessageToHistory(message MqttMessage) {
	msg := message
	m.mutex.Lock()
	defer m.mutex.Unlock()
	p := &msg
	entry, ok := m.latest[p.Topic]
	if ok {
		if entry.pinned {
			// The previous newest message was held only by this map; replacing
			// it releases those bytes and makes the topic recent again.
			m.latestBytes -= pinnedCost(entry.msg)
			m.unlinkLocked(entry)
			entry.pinned = false
		}
		entry.msg = p
	} else {
		m.latest[p.Topic] = &latestEntry{msg: p, topic: p.Topic}
	}
	m.recent = append(m.recent, p)
	m.recentBytes += int64(p.estimatedBytes())
	m.evictLocked()
}

// pinnedCost is what a latest entry costs once it is the sole holder of its
// message.
func pinnedCost(msg *MqttMessage) int64 {
	return int64(msg.estimatedBytes()) + latestEntryOverhead
}

// evictLocked drops retained data until the store is back under budget.
// Caller holds mutex.
//
// Priority: trim the latest map first if it is over its share, otherwise drop
// the oldest recent message, and only once the recent window is drained fall
// back to trimming latest below its share. Each iteration either frees bytes
// or moves a message's charge from recent to latest, so the loop terminates.
func (m *MessageHistory) evictLocked() {
	latestBudget := m.budgetBytes / latestBudgetDivisor
	for m.recentBytes+m.latestBytes > m.budgetBytes {
		if m.latestBytes > latestBudget && m.lruOldest != nil {
			m.dropOldestLatestLocked()
			continue
		}
		if m.head < len(m.recent) {
			m.evictOldestRecentLocked()
			continue
		}
		if m.lruOldest != nil {
			m.dropOldestLatestLocked()
			continue
		}
		// Nothing retained left to drop: a single message larger than the
		// whole budget. Keep it rather than spin.
		break
	}
	m.compactLocked()
}

// evictOldestRecentLocked drops recent[head]. If that message is still the
// newest for its topic the latest map becomes its only holder, so the entry is
// pinned: its bytes move from recentBytes to latestBytes and it joins the LRU
// list as the most recently updated pinned topic.
func (m *MessageHistory) evictOldestRecentLocked() {
	old := m.recent[m.head]
	m.recent[m.head] = nil // release for GC
	m.head++
	m.recentBytes -= int64(old.estimatedBytes())
	if entry, ok := m.latest[old.Topic]; ok && entry.msg == old {
		entry.pinned = true
		m.latestBytes += pinnedCost(old)
		m.linkNewestLocked(entry)
	}
}

// dropOldestLatestLocked discards the least recently updated pinned topic.
// That topic's last value is gone from memory: selecting it in the tree falls
// back to whatever the frontend already holds.
func (m *MessageHistory) dropOldestLatestLocked() {
	entry := m.lruOldest
	m.latestBytes -= pinnedCost(entry.msg)
	m.unlinkLocked(entry)
	delete(m.latest, entry.topic)
	entry.msg = nil
	m.droppedTopics++
}

func (m *MessageHistory) linkNewestLocked(entry *latestEntry) {
	entry.prev = m.lruNewest
	entry.next = nil
	if m.lruNewest != nil {
		m.lruNewest.next = entry
	}
	m.lruNewest = entry
	if m.lruOldest == nil {
		m.lruOldest = entry
	}
}

func (m *MessageHistory) unlinkLocked(entry *latestEntry) {
	if entry.prev != nil {
		entry.prev.next = entry.next
	} else if m.lruOldest == entry {
		m.lruOldest = entry.next
	}
	if entry.next != nil {
		entry.next.prev = entry.prev
	} else if m.lruNewest == entry {
		m.lruNewest = entry.prev
	}
	entry.prev = nil
	entry.next = nil
}

// compactLocked reclaims the dead prefix of the recent backing array once head
// has consumed half of it, rather than letting it grow unbounded.
func (m *MessageHistory) compactLocked() {
	if m.head > 0 && m.head*2 >= len(m.recent) {
		n := copy(m.recent, m.recent[m.head:])
		for i := n; i < len(m.recent); i++ {
			m.recent[i] = nil
		}
		m.recent = m.recent[:n]
		m.head = 0
	}
}

// GetTopicHistory returns the retained messages for a topic in arrival order.
// If the topic's messages have all aged out of the recent window, its latest
// value is still returned so a tree-click is never empty — unless the topic
// was also dropped from the latest map under budget pressure, which only
// happens at extreme topic cardinality.
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
		if entry, ok := m.latest[topic]; ok {
			return []MqttMessage{*entry.msg}, nil
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
	for topic, entry := range m.latest {
		if strings.HasPrefix(topic, prefix) && !inWindow[topic] {
			result = append(result, *entry.msg)
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
	for topic, entry := range m.latest {
		if _, ok := out[topic]; !ok {
			out[topic] = []MqttMessage{*entry.msg}
		}
	}
	return out
}
