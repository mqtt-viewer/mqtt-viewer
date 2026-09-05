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
//
// Only pinned entries carry this charge. An unpinned entry's overhead rides
// free, which undercounts by at most ~19% of the budget in the pathological
// case where every message in the recent window is on its own topic. That is
// covered by estimatedBytes, which measures ~1.4x real heap.
const latestEntryOverhead = 96

// sysTopicPrefix marks broker-published metadata. These topics are few, are
// what the broker status window reads, and some (a broker's version, say) are
// published once as retained and never again — exactly the value the latest
// map exists to hold, and exactly the entry a plain LRU would drop first on a
// busy broker. Up to maxProtectedSysTopics of them are kept out of the LRU
// list so they survive; the cap keeps a broker that publishes a huge $SYS
// tree from turning the exemption into a hole in the budget.
const (
	sysTopicPrefix        = "$SYS/"
	maxProtectedSysTopics = 1024
)

// latestEntry is the latest-per-topic slot for one topic.
//
// While the entry's message is still inside the recent window it is unpinned
// and costs nothing extra: those bytes are already charged to recentBytes.
// Once the message is evicted from `recent` the entry becomes the only thing
// keeping it alive, so it is pinned and charged to latestBytes. A pinned entry
// is either linked into the LRU list, or protected (a $SYS topic within the
// cap) and so not evictable at all.
type latestEntry struct {
	msg        *MqttMessage
	topic      string
	pinned     bool
	protected  bool
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
//   - retained: the topics we currently believe hold a retained message.
//     Bounded by topic cardinality and never evicted by the byte budget. See
//     the field comment for what it can and cannot tell you.
//
// Every retained message is charged exactly once: to recentBytes while it is
// in the recent window, then to latestBytes if the latest map pins it after
// eviction. recentBytes + latestBytes is what the budget bounds.
type MessageHistory struct {
	mutex  sync.Mutex
	recent []*MqttMessage
	head   int
	latest map[string]*latestEntry
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
	recentBytes int64
	latestBytes int64
	budgetBytes int64
	// lruOldest/lruNewest bound the list of pinned latest entries, ordered by
	// when each topic last received a message: lruOldest is the least recently
	// updated topic and the first to be dropped. Unpinned entries are not
	// listed; their topics are all newer than every pinned one, because a
	// topic pins exactly when its newest message leaves the recent window.
	// Protected entries are not listed either, so they cannot be picked.
	lruOldest *latestEntry
	lruNewest *latestEntry
	// protectedSysTopics counts pinned $SYS entries held out of the LRU list.
	protectedSysTopics int
	// droppedTopics counts latest entries discarded under budget pressure.
	droppedTopics int64
}

func newMessageHistory() *MessageHistory {
	return &MessageHistory{
		recent:      make([]*MqttMessage, 0, 1024),
		latest:      make(map[string]*latestEntry),
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
	m.retained = make(map[string]struct{})
	m.recentBytes = 0
	m.latestBytes = 0
	m.lruOldest = nil
	m.lruNewest = nil
	m.protectedSysTopics = 0
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
			m.unpinLocked(entry)
		}
		entry.msg = p
	} else {
		m.latest[p.Topic] = &latestEntry{msg: p, topic: p.Topic}
	}
	m.trackRetainedLocked(p)
	m.recent = append(m.recent, p)
	m.recentBytes += int64(p.estimatedBytes())
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
//
// Protected $SYS entries are never dropped, so the store can sit above budget
// by at most maxProtectedSysTopics entries' worth (a few hundred KB) if a
// broker's $SYS tree alone exceeds it.
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
	entry, ok := m.latest[old.Topic]
	if !ok || entry.msg != old {
		return
	}
	cost := pinnedCost(old)
	if cost > m.budgetBytes/latestBudgetDivisor {
		// One message too big for the whole last-value share would evict every
		// other topic to make room for itself. Let it go instead: the topic
		// loses the value that did not fit, rather than every topic losing
		// theirs.
		delete(m.latest, old.Topic)
		m.droppedTopics++
		return
	}
	entry.pinned = true
	m.latestBytes += cost
	if strings.HasPrefix(entry.topic, sysTopicPrefix) && m.protectedSysTopics < maxProtectedSysTopics {
		entry.protected = true
		m.protectedSysTopics++
		return
	}
	m.linkNewestLocked(entry)
}

// unpinLocked releases a pinned entry back to unpinned state, taking it out of
// whichever structure was holding it. The caller adjusts latestBytes.
func (m *MessageHistory) unpinLocked(entry *latestEntry) {
	if entry.protected {
		entry.protected = false
		m.protectedSysTopics--
	} else {
		m.unlinkLocked(entry)
	}
	entry.pinned = false
}

// dropOldestLatestLocked discards the least recently updated pinned topic.
// That topic's last value is gone from memory: selecting it in the tree falls
// back to whatever the frontend already holds.
func (m *MessageHistory) dropOldestLatestLocked() {
	entry := m.lruOldest
	m.latestBytes -= pinnedCost(entry.msg)
	m.unpinLocked(entry)
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

// GetTopicHistory returns every retained message for a topic in arrival
// order. Unbounded: only for paths that genuinely need the full window (e.g.
// export). UI paths must use GetTopicHistoryWindow: copying a busy topic's
// entire history while holding the mutex stalls every concurrent receive.
//
// If the topic's messages have all aged out of the recent window, its latest
// value is still returned so a tree-click is never empty, unless the topic
// was also dropped from the latest map under budget pressure, which only
// happens at extreme topic cardinality.
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
		if entry, ok := m.latest[topic]; ok {
			return []MqttMessage{*entry.msg}, nil
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
		if entry, ok := m.latest[topic]; ok {
			return []MqttMessageStub{entry.msg.Stub()}, nil
		}
		return nil, fmt.Errorf("topic not found in message history")
	}
	return result, nil
}

// SLACK_MS bounds how far a message's position in `recent` can disagree with
// its TimeMs. Appends now run in order on the receiving goroutine (see
// receiveMessage in receive.go), but the slice is only guaranteed near-sorted
// by TimeMs (clock adjustments, and messages stamped before they are
// appended), so any time-hinted lookup widens its search window by this
// slack. 2s is orders of magnitude more than any observed reordering while
// still keeping hinted lookups tiny relative to the full window.
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
	for topic, entry := range m.latest {
		if strings.HasPrefix(topic, prefix) && !inWindow[topic] {
			result = append(result, *entry.msg)
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
// matches every retained topic. Broker-reserved ($) topics are always
// excluded, so a bulk clear can never be offered over broker internals.
//
// Matching is on topic-level boundaries, not raw string prefix: "a/b" matches
// "a/b" and "a/b/c", but never "a/bc".
func (m *MessageHistory) RetainedUnderPrefix(prefix string) []string {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	result := make([]string, 0, 16)
	for topic := range m.retained {
		if isBrokerReservedTopic(topic) {
			// $SYS/... and friends are the broker's own namespace, never ours
			// to retain or clear.
			continue
		}
		if matchesTopicPrefix(topic, prefix) {
			result = append(result, topic)
		}
	}
	sort.Strings(result)
	return result
}

// UnmarkRetained drops topics from the retained index. Clearing a retained
// message is only echoed back to us on MQTT 5 (RetainAsPublished), so under
// MQTT 3 the index would stay marked forever unless the clear updates it
// directly.
func (m *MessageHistory) UnmarkRetained(topics ...string) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	for _, topic := range topics {
		delete(m.retained, topic)
	}
}

// ClearRetainedIndex empties the retained index without touching message
// history. Called when a connection (re)subscribes: the broker replays its
// current retained set immediately afterwards, so rebuilding from that replay
// is the only way to drop topics tombstoned while we were away.
func (m *MessageHistory) ClearRetainedIndex() {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	m.retained = make(map[string]struct{})
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

// isBrokerReservedTopic reports whether a topic sits in the broker's own
// namespace. Topic names beginning with $ are reserved for the server
// ($SYS/... on most brokers), and are never ours to retain or clear.
func isBrokerReservedTopic(topic string) bool {
	return strings.HasPrefix(topic, "$")
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
	if entry, ok := m.latest[topic]; ok && entry.msg.Id == id {
		return *entry.msg, true
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
	for topic, entry := range m.latest {
		if _, ok := out[topic]; !ok {
			out[topic] = []MqttMessage{*entry.msg}
		}
	}
	return out
}
