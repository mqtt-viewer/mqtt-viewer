package mqtt

import (
	"fmt"
	"testing"
	"time"
)

func estBytes(m MqttMessage) int { return m.estimatedBytes() }

func msg(topic string, payloadLen int) MqttMessage {
	return MqttMessage{
		Id:      "00000000-0000-0000-0000-000000000000",
		Topic:   topic,
		Payload: make([]byte, payloadLen),
		TimeMs:  time.Now().UnixMilli(),
		Time:    time.Now(),
	}
}

func TestHistoryKeepsAllUnderBudget(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024) // 10MB, plenty
	for i := 0; i < 100; i++ {
		h.addMessageToHistory(msg("a/b", 100))
	}
	got, err := h.GetTopicHistory("a/b")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 100 {
		t.Errorf("expected 100 messages retained, got %d", len(got))
	}
}

func TestHistoryEvictsOldestOverBudget(t *testing.T) {
	h := newMessageHistory()
	// Budget that holds roughly a few messages: each ~256 + 1024 payload.
	perMsg := estBytes(msg("t", 1024))
	h.SetBudgetBytes(int64(perMsg * 5))

	for i := 0; i < 50; i++ {
		h.addMessageToHistory(msg("t", 1024))
	}

	got, err := h.GetTopicHistory("t")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should retain about 5 (the budget), never all 50.
	if len(got) == 0 || len(got) > 6 {
		t.Errorf("expected ~5 retained under budget, got %d", len(got))
	}
	if h.TotalBytes() > h.budgetBytes {
		t.Errorf("retained bytes %d exceed budget %d after eviction", h.TotalBytes(), h.budgetBytes)
	}
}

func TestHistoryKeepsLatestPerTopicAfterEviction(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("x", 1024))
	// Budget for ~12 messages, so the latest map's quarter share comfortably
	// holds the one quiet topic.
	h.SetBudgetBytes(int64(perMsg * 12))

	// One message on a low-traffic topic, then flood a different topic so the
	// low-traffic topic's only message ages out of the recent window.
	h.addMessageToHistory(msg("low/traffic", 1024))
	for i := 0; i < 50; i++ {
		h.addMessageToHistory(msg("busy/topic", 1024))
	}

	// Selecting the low-traffic topic must still return its latest value.
	got, err := h.GetTopicHistory("low/traffic")
	if err != nil {
		t.Fatalf("expected latest-per-topic fallback, got error: %v", err)
	}
	if len(got) != 1 || got[0].Topic != "low/traffic" {
		t.Errorf("expected 1 latest message for low/traffic, got %+v", got)
	}
}

func TestHistoryGetAllIncludesEvictedTopicLatest(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("x", 1024))
	h.SetBudgetBytes(int64(perMsg * 12))

	h.addMessageToHistory(msg("topic/a", 1024))
	for i := 0; i < 50; i++ {
		h.addMessageToHistory(msg("topic/b", 1024))
	}

	all := h.GetAllHistory()
	if _, ok := all["topic/a"]; !ok {
		t.Error("expected topic/a latest present in GetAllHistory after eviction")
	}
	if _, ok := all["topic/b"]; !ok {
		t.Error("expected topic/b present in GetAllHistory")
	}
}

func TestHistoryGetByTopicPrefixFiltersAndOrders(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)

	// Interleave $SYS and non-$SYS topics; arrival order is insertion order.
	h.addMessageToHistory(msg("$SYS/broker/uptime", 10))
	h.addMessageToHistory(msg("factory/line1/s1", 10))
	h.addMessageToHistory(msg("$SYS/broker/clients/connected", 10))
	// "$SYS" alone (no trailing slash) must not match the "$SYS/" prefix.
	h.addMessageToHistory(msg("$SYS", 10))

	got := h.GetHistoryByTopicPrefix("$SYS/")
	if len(got) != 2 {
		t.Fatalf("expected 2 $SYS/ messages, got %d (%+v)", len(got), got)
	}
	for _, m := range got {
		if m.Topic != "$SYS/broker/uptime" && m.Topic != "$SYS/broker/clients/connected" {
			t.Errorf("unexpected topic in prefix result: %v", m.Topic)
		}
	}
}

func TestHistoryGetByTopicPrefixIncludesEvictedLatest(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("x", 1024))
	h.SetBudgetBytes(int64(perMsg * 12))

	// One $SYS message, then flood a different $SYS topic so the first ages out
	// of the recent window; its latest value must still be returned.
	h.addMessageToHistory(msg("$SYS/broker/uptime", 1024))
	for i := 0; i < 50; i++ {
		h.addMessageToHistory(msg("$SYS/broker/load", 1024))
	}

	got := h.GetHistoryByTopicPrefix("$SYS/")
	seen := map[string]bool{}
	for _, m := range got {
		seen[m.Topic] = true
	}
	if !seen["$SYS/broker/uptime"] {
		t.Error("expected aged-out $SYS/broker/uptime latest present in prefix result")
	}
	if !seen["$SYS/broker/load"] {
		t.Error("expected $SYS/broker/load present in prefix result")
	}
}

func TestHistoryGetByTopicPrefixEmpty(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	h.addMessageToHistory(msg("factory/line1/s1", 10))
	if got := h.GetHistoryByTopicPrefix("$SYS/"); len(got) != 0 {
		t.Errorf("expected no matches, got %d", len(got))
	}
}

func TestHistoryClearPreservesBudget(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(123456)
	for i := 0; i < 10; i++ {
		h.addMessageToHistory(msg("a", 100))
	}
	h.Clear()
	if h.TotalBytes() != 0 || len(h.recent) != 0 || h.head != 0 {
		t.Errorf("expected empty after clear, got bytes=%d recent=%d head=%d", h.TotalBytes(), len(h.recent), h.head)
	}
	if h.lruOldest != nil || h.lruNewest != nil {
		t.Error("expected empty latest LRU list after clear")
	}
	if h.budgetBytes != 123456 {
		t.Errorf("expected budget preserved after clear, got %d", h.budgetBytes)
	}
	if _, err := h.GetTopicHistory("a"); err == nil {
		t.Error("expected topic-not-found after clear")
	}
}

func TestHistoryTotalBytesCountsPinnedLatest(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("topic/00", 1024))
	// Budget for ~12 messages, then one message on each of a few distinct
	// topics so most age out of the recent window but stay pinned in the
	// latest map. Their bytes must show up in the readout.
	h.SetBudgetBytes(int64(perMsg * 12))
	const topics = 20
	for i := 0; i < topics; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("topic/%02d", i), 1024))
	}

	if h.latestBytes == 0 {
		t.Error("expected pinned latest messages to be charged to latestBytes")
	}
	if h.TotalBytes() != h.recentBytes+h.latestBytes {
		t.Errorf("TotalBytes %d does not match recent %d + latest %d", h.TotalBytes(), h.recentBytes, h.latestBytes)
	}

	// Republishing to topics whose latest was pinned must not grow latestBytes
	// unboundedly: each replacement releases the old pin.
	for i := 0; i < 500; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("topic/%02d", i%topics), 1024))
	}
	if max := int64(topics * (perMsg + latestEntryOverhead)); h.latestBytes > max {
		t.Errorf("latestBytes %d exceeds topic-cardinality bound %d", h.latestBytes, max)
	}
	if h.latestBytes < 0 || h.recentBytes < 0 {
		t.Errorf("byte counters went negative: recent=%d latest=%d", h.recentBytes, h.latestBytes)
	}
	assertHistoryAccounting(t, h)

	h.Clear()
	if h.TotalBytes() != 0 {
		t.Errorf("expected TotalBytes 0 after clear, got %d", h.TotalBytes())
	}
}

// assertHistoryAccounting recomputes both byte counters from scratch and
// checks the pinned-entry invariants, so a bookkeeping slip in eviction can't
// pass unnoticed.
func assertHistoryAccounting(t *testing.T, h *MessageHistory) {
	t.Helper()
	var wantRecent, wantLatest int64
	inWindow := map[*MqttMessage]bool{}
	for i := h.head; i < len(h.recent); i++ {
		wantRecent += int64(h.recent[i].estimatedBytes())
		inWindow[h.recent[i]] = true
	}
	pinned, protected := 0, 0
	for topic, entry := range h.latest {
		if entry.topic != topic {
			t.Errorf("latest entry key %q does not match entry topic %q", topic, entry.topic)
		}
		if entry.pinned == inWindow[entry.msg] {
			t.Errorf("topic %q: pinned=%v but inRecentWindow=%v", topic, entry.pinned, inWindow[entry.msg])
		}
		if entry.protected && !entry.pinned {
			t.Errorf("topic %q is protected but not pinned", topic)
		}
		if entry.pinned {
			pinned++
			wantLatest += pinnedCost(entry.msg)
		}
		if entry.protected {
			protected++
		}
	}
	if protected != h.protectedSysTopics {
		t.Errorf("protectedSysTopics %d, recomputed %d", h.protectedSysTopics, protected)
	}
	if wantRecent != h.recentBytes {
		t.Errorf("recentBytes %d, recomputed %d", h.recentBytes, wantRecent)
	}
	if wantLatest != h.latestBytes {
		t.Errorf("latestBytes %d, recomputed %d", h.latestBytes, wantLatest)
	}
	listed := 0
	for e := h.lruOldest; e != nil; e = e.next {
		listed++
		if !e.pinned {
			t.Errorf("unpinned topic %q is in the LRU list", e.topic)
		}
		if e.next != nil && e.next.prev != e {
			t.Errorf("LRU list links are inconsistent at topic %q", e.topic)
		}
	}
	if listed != pinned-protected {
		t.Errorf("LRU list holds %d entries, %d topics are pinned and evictable", listed, pinned-protected)
	}
}

func TestHistoryKeepsSysTopicsWhenTrimmingLatest(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("sensors/00000", 200))
	h.SetBudgetBytes(int64(perMsg * 500))

	// A $SYS value published once at connect, the way a broker announces its
	// version, then enough traffic across enough topics to force the latest
	// map to trim. The $SYS value is the oldest of all, so a plain LRU would
	// drop it first, and the broker status window would lose it for good.
	h.addMessageToHistory(msg("$SYS/broker/version", 200))
	for i := 0; i < 50000; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("sensors/%05d", i), 200))
	}

	if h.droppedTopics == 0 {
		t.Fatal("expected the latest map to be trimmed in this scenario")
	}
	got, err := h.GetTopicHistory("$SYS/broker/version")
	if err != nil {
		t.Fatalf("expected the $SYS value to survive trimming, got %v", err)
	}
	if len(got) != 1 || got[0].Topic != "$SYS/broker/version" {
		t.Errorf("unexpected $SYS history: %+v", got)
	}
	assertHistoryAccounting(t, h)
}

func TestHistoryCapsProtectedSysTopics(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("$SYS/broker/000000", 200))
	h.SetBudgetBytes(int64(perMsg * 8000))

	// More $SYS topics than the protection cap, then traffic to age them all
	// out and force trimming. Protection must stop at the cap so a broker with
	// a huge $SYS tree cannot pin unbounded memory.
	for i := 0; i < maxProtectedSysTopics*2; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("$SYS/broker/%06d", i), 200))
	}
	for i := 0; i < 50000; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("sensors/%05d", i), 200))
	}

	if h.protectedSysTopics > maxProtectedSysTopics {
		t.Errorf("protected %d $SYS topics, cap is %d", h.protectedSysTopics, maxProtectedSysTopics)
	}
	if h.TotalBytes() > h.budgetBytes+int64(maxProtectedSysTopics)*(int64(perMsg)+latestEntryOverhead) {
		t.Errorf("retained bytes %d exceed budget %d by more than the protected allowance", h.TotalBytes(), h.budgetBytes)
	}
	assertHistoryAccounting(t, h)
}

func TestHistoryOversizedMessageDoesNotClearLatestMap(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("quiet/000", 200))
	budget := int64(perMsg * 400)
	h.SetBudgetBytes(budget)

	// Fill the latest map with quiet topics that have aged out.
	for i := 0; i < 200; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("quiet/%03d", i), 200))
	}
	for i := 0; i < 400; i++ {
		h.addMessageToHistory(msg("busy/topic", 200))
	}
	pinnedBefore := 0
	for _, entry := range h.latest {
		if entry.pinned {
			pinnedBefore++
		}
	}
	if pinnedBefore == 0 {
		t.Fatal("expected quiet topics to be pinned before the oversized message")
	}

	// One message larger than the whole latest share, then enough traffic to
	// age it out of the recent window. Pinning it at that point would evict
	// every other topic to make room for a single value.
	h.addMessageToHistory(msg("huge/topic", int(budget/latestBudgetDivisor)+1))
	for i := 0; i < 400; i++ {
		h.addMessageToHistory(msg("busy/topic", 200))
	}

	pinnedAfter := 0
	for _, entry := range h.latest {
		if entry.pinned {
			pinnedAfter++
		}
	}
	if pinnedAfter == 0 {
		t.Error("an oversized message wiped every pinned topic from the latest map")
	}
	if _, ok := h.latest["huge/topic"]; ok {
		t.Error("expected the oversized message to be dropped rather than pinned")
	}
	if h.TotalBytes() > h.budgetBytes {
		t.Errorf("retained bytes %d exceed budget %d", h.TotalBytes(), h.budgetBytes)
	}
	assertHistoryAccounting(t, h)
}

func TestHistoryBoundsLatestMapAtHighCardinality(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("sensors/00000/temperature", 200))
	// A budget worth ~500 messages against 50k distinct topics: without a
	// bound the latest map alone would hold 50k messages regardless of it.
	budget := int64(perMsg * 500)
	h.SetBudgetBytes(budget)
	const topics = 50000
	for i := 0; i < topics; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("sensors/%05d/temperature", i), 200))
	}

	if h.TotalBytes() > budget {
		t.Errorf("retained bytes %d exceed budget %d at %d topics", h.TotalBytes(), budget, topics)
	}
	if len(h.latest) >= topics {
		t.Errorf("latest map kept %d of %d topics; expected it to be trimmed", len(h.latest), topics)
	}
	if h.droppedTopics == 0 {
		t.Error("expected topics to be dropped from the latest map")
	}
	if latestBudget := budget / latestBudgetDivisor; h.latestBytes > latestBudget {
		t.Errorf("latestBytes %d exceeds its %d share of the budget", h.latestBytes, latestBudget)
	}
	// The recent window must not have been starved by the latest map.
	if h.recentBytes == 0 {
		t.Error("expected the recent window to keep messages alongside the latest map")
	}
	assertHistoryAccounting(t, h)
}

func TestHistoryDropsLeastRecentlyUpdatedTopicFirst(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("t/000", 1024))
	// Room for ~2 pinned latest entries (a quarter of ~12 messages).
	h.SetBudgetBytes(int64(perMsg * 12))

	// Three quiet topics in a known order, then enough traffic on a busy topic
	// to push all three out of the recent window and over the latest share.
	for _, topic := range []string{"quiet/a", "quiet/b", "quiet/c"} {
		h.addMessageToHistory(msg(topic, 1024))
	}
	for i := 0; i < 50; i++ {
		h.addMessageToHistory(msg("busy/topic", 1024))
	}

	if _, ok := h.latest["quiet/a"]; ok {
		t.Error("expected the least recently updated topic (quiet/a) to be dropped first")
	}
	if _, ok := h.latest["quiet/c"]; !ok {
		t.Error("expected the most recently updated quiet topic (quiet/c) to be kept")
	}
	assertHistoryAccounting(t, h)
}

func TestHistoryKeepsEveryTopicAtNormalCardinality(t *testing.T) {
	h := newMessageHistory()
	// A realistic broker: 5,000 topics, 200 B payloads, default budget. Every
	// topic must still answer with its last value.
	h.SetBudgetBytes(DefaultMemoryBudgetBytes)
	const topics = 5000
	for round := 0; round < 3; round++ {
		for i := 0; i < topics; i++ {
			h.addMessageToHistory(msg(fmt.Sprintf("factory/line%02d/sensor%03d", i%50, i/50), 200))
		}
	}

	if h.droppedTopics != 0 {
		t.Errorf("dropped %d topics at normal cardinality; the tree must keep them all", h.droppedTopics)
	}
	for i := 0; i < topics; i++ {
		topic := fmt.Sprintf("factory/line%02d/sensor%03d", i%50, i/50)
		if _, err := h.GetTopicHistory(topic); err != nil {
			t.Fatalf("expected history for %s, got %v", topic, err)
		}
	}
}

func TestHistoryLoweringBudgetTrimsLatestMap(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(DefaultMemoryBudgetBytes)
	const topics = 20000
	for i := 0; i < topics; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("sensors/%05d", i), 200))
	}
	if h.droppedTopics != 0 {
		t.Fatalf("expected no drops under the default budget, got %d", h.droppedTopics)
	}

	tightened := int64(64 * 1024)
	h.SetBudgetBytes(tightened)
	if h.TotalBytes() > tightened {
		t.Errorf("retained bytes %d exceed the tightened budget %d", h.TotalBytes(), tightened)
	}
	assertHistoryAccounting(t, h)
}

func TestHistoryUnknownTopic(t *testing.T) {
	h := newMessageHistory()
	if _, err := h.GetTopicHistory("nope"); err == nil {
		t.Error("expected error for unknown topic")
	}
}

func TestHistoryCompactionKeepsCorrectness(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("t", 64))
	h.SetBudgetBytes(int64(perMsg * 4))
	// Drive many evictions to exercise compaction repeatedly.
	for i := 0; i < 1000; i++ {
		h.addMessageToHistory(msg("t", 64))
	}
	got, err := h.GetTopicHistory("t")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) == 0 || len(got) > 5 {
		t.Errorf("expected bounded retention after compaction, got %d", len(got))
	}
	// recent backing slice should not have grown without bound.
	if len(h.recent) > 16 {
		t.Errorf("expected compacted recent slice, len=%d", len(h.recent))
	}
}

// ensure the multi-topic example used in docs behaves
func TestHistoryMultiTopicOrdering(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	for i := 0; i < 5; i++ {
		h.addMessageToHistory(msg(fmt.Sprintf("topic/%d", i), 10))
	}
	all := h.GetAllHistory()
	if len(all) != 5 {
		t.Errorf("expected 5 topics, got %d", len(all))
	}
}

func TestTopicHistoryWindowReturnsNewestInOrder(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	for i := 0; i < 30; i++ {
		m := msg("w/t", 10)
		m.TimeMs = int64(i)
		h.addMessageToHistory(m)
		// interleave other-topic traffic so the backward scan must skip
		h.addMessageToHistory(msg("other", 10))
	}

	got, err := h.GetTopicHistoryWindow("w/t", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 10 {
		t.Fatalf("expected 10 messages, got %d", len(got))
	}
	// newest 10 (TimeMs 20..29) in arrival order
	for i, m := range got {
		if m.TimeMs != int64(20+i) {
			t.Errorf("index %d: expected TimeMs %d, got %d", i, 20+i, m.TimeMs)
		}
	}
}

func TestTopicHistoryWindowZeroLimitReturnsAll(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	for i := 0; i < 25; i++ {
		h.addMessageToHistory(msg("all/t", 10))
	}
	got, err := h.GetTopicHistoryWindow("all/t", 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 25 {
		t.Errorf("expected all 25 messages, got %d", len(got))
	}
}

func TestTopicTimelineWindowReturnsStubsNewestInOrder(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	for i := 0; i < 30; i++ {
		m := msg("w/t", 10)
		m.TimeMs = int64(i)
		h.addMessageToHistory(m)
		// interleave other-topic traffic so the backward scan must skip
		h.addMessageToHistory(msg("other", 10))
	}

	got, err := h.GetTopicTimelineWindow("w/t", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 10 {
		t.Fatalf("expected 10 stubs, got %d", len(got))
	}
	// newest 10 (TimeMs 20..29) in arrival order
	for i, m := range got {
		if m.TimeMs != int64(20+i) {
			t.Errorf("index %d: expected TimeMs %d, got %d", i, 20+i, m.TimeMs)
		}
	}
}

func TestTopicTimelineWindowFallsBackToLatestWhenAgedOut(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("x", 1024))
	// Budget for ~12 messages, so the latest map's quarter share comfortably
	// holds the one quiet topic (see latestBudgetDivisor).
	h.SetBudgetBytes(int64(perMsg * 12))

	h.addMessageToHistory(msg("low/traffic", 1024))
	for i := 0; i < 20; i++ {
		h.addMessageToHistory(msg("busy/topic", 1024))
	}

	got, err := h.GetTopicTimelineWindow("low/traffic", 10)
	if err != nil {
		t.Fatalf("expected latest-per-topic fallback, got error: %v", err)
	}
	if len(got) != 1 {
		t.Errorf("expected 1 latest stub for low/traffic, got %+v", got)
	}
}

func TestTopicTimelineWindowUnknownTopic(t *testing.T) {
	h := newMessageHistory()
	if _, err := h.GetTopicTimelineWindow("nope", 10); err == nil {
		t.Error("expected error for unknown topic")
	}
}

func TestGetMessageByIdFindsMessageInWindow(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	m := msg("find/me", 10)
	m.Id = "target-id"
	h.addMessageToHistory(m)
	for i := 0; i < 5; i++ {
		h.addMessageToHistory(msg("other", 10))
	}

	// Hint 0 exercises the compatibility full-scan path.
	got, found := h.GetMessageById("find/me", "target-id", 0)
	if !found {
		t.Fatal("expected message to be found")
	}
	if got.Id != "target-id" || got.Topic != "find/me" {
		t.Errorf("unexpected message returned: %+v", got)
	}
}

func TestGetMessageByIdFindsAgedOutMessageViaLatestFallback(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("x", 1024))
	// Budget for ~12 messages, so the latest map's quarter share comfortably
	// holds the one quiet topic (see latestBudgetDivisor).
	h.SetBudgetBytes(int64(perMsg * 12))

	m := msg("low/traffic", 1024)
	m.Id = "aged-out-id"
	h.addMessageToHistory(m)
	for i := 0; i < 20; i++ {
		h.addMessageToHistory(msg("busy/topic", 1024))
	}

	// The message's content aged out of the recent ring, but it's still the
	// latest value recorded for its topic, so it must still be found.
	got, found := h.GetMessageById("low/traffic", "aged-out-id", 0)
	if !found {
		t.Fatal("expected aged-out message to be found via latest fallback")
	}
	if got.Id != "aged-out-id" {
		t.Errorf("unexpected message returned: %+v", got)
	}
}

func TestGetMessageByIdReportsNotFoundWhenSupersededAndAgedOut(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("x", 1024))
	// Budget for ~12 messages, so the latest map's quarter share comfortably
	// holds the one quiet topic (see latestBudgetDivisor).
	h.SetBudgetBytes(int64(perMsg * 12))

	m := msg("low/traffic", 1024)
	m.Id = "superseded-id"
	h.addMessageToHistory(m)
	// A newer message on the same topic replaces the latest pointer, and
	// enough other traffic follows to push both out of the recent ring.
	newer := msg("low/traffic", 1024)
	newer.Id = "current-id"
	h.addMessageToHistory(newer)
	for i := 0; i < 20; i++ {
		h.addMessageToHistory(msg("busy/topic", 1024))
	}

	_, found := h.GetMessageById("low/traffic", "superseded-id", 0)
	if found {
		t.Error("expected superseded, aged-out message to not be found")
	}
}

func TestGetMessageByIdUnknownTopicOrId(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	h.addMessageToHistory(msg("a/b", 10))

	if _, found := h.GetMessageById("a/b", "no-such-id", 0); found {
		t.Error("expected not found for unknown id")
	}
	if _, found := h.GetMessageById("nope", "no-such-id", 0); found {
		t.Error("expected not found for unknown topic")
	}
}

func TestGetMessageByIdWithHintFindsExactMatch(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	base := int64(1_000_000)
	for i := 0; i < 200; i++ {
		m := msg("hint/t", 10)
		m.Id = fmt.Sprintf("id-%d", i)
		m.TimeMs = base + int64(i*10)
		h.addMessageToHistory(m)
	}

	got, found := h.GetMessageById("hint/t", "id-77", base+770)
	if !found {
		t.Fatal("expected hinted lookup to find the message")
	}
	if got.Id != "id-77" {
		t.Errorf("unexpected message returned: %+v", got)
	}
}

func TestGetMessageByIdWithHintToleratesOutOfOrderInsertion(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	base := int64(1_000_000)
	// Simulate the per-message-goroutine reordering: the target's TimeMs
	// says it belongs earlier/later than where it actually sits in the
	// slice, off by up to a second either way.
	for i := 0; i < 50; i++ {
		m := msg("ooo/t", 10)
		m.Id = fmt.Sprintf("pre-%d", i)
		m.TimeMs = base + int64(i*100)
		h.addMessageToHistory(m)
	}
	early := msg("ooo/t", 10)
	early.Id = "target-early"
	early.TimeMs = base + 5000 - 1000 // inserted now, timestamped 1s earlier
	h.addMessageToHistory(early)
	late := msg("ooo/t", 10)
	late.Id = "target-late"
	late.TimeMs = base + 5000 + 1000 // inserted now, timestamped 1s later
	h.addMessageToHistory(late)
	for i := 0; i < 50; i++ {
		m := msg("ooo/t", 10)
		m.Id = fmt.Sprintf("post-%d", i)
		m.TimeMs = base + 5200 + int64(i*100)
		h.addMessageToHistory(m)
	}

	if _, found := h.GetMessageById("ooo/t", "target-early", early.TimeMs); !found {
		t.Error("expected hinted lookup to find message inserted 1s later than its TimeMs")
	}
	if _, found := h.GetMessageById("ooo/t", "target-late", late.TimeMs); !found {
		t.Error("expected hinted lookup to find message inserted 1s earlier than its TimeMs")
	}
}

func TestGetMessageByIdWithHintFastAgedOutCheck(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	base := int64(1_000_000)
	for i := 0; i < 100; i++ {
		m := msg("fast/t", 10)
		m.Id = fmt.Sprintf("id-%d", i)
		m.TimeMs = base + int64(i)
		h.addMessageToHistory(m)
	}

	// Hint far older than the window's oldest entry: evicted, and the topic's
	// latest is a different id, so this must be not-found (O(1) path).
	if _, found := h.GetMessageById("fast/t", "long-gone", base-SLACK_MS-10_000); found {
		t.Error("expected fast aged-out check to report not found")
	}
}

func TestGetMessageByIdWithHintFallsBackToLatest(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("x", 1024))
	// Budget for ~12 messages, so the latest map's quarter share comfortably
	// holds the one quiet topic (see latestBudgetDivisor).
	h.SetBudgetBytes(int64(perMsg * 12))

	old := msg("low/traffic", 1024)
	old.Id = "aged-out-id"
	old.TimeMs = 1 // far older than anything retained after the flood below
	h.addMessageToHistory(old)
	for i := 0; i < 20; i++ {
		m := msg("busy/topic", 1024)
		m.TimeMs = 1_000_000 + int64(i)
		h.addMessageToHistory(m)
	}

	// The hint is far older than the window, but the message is still the
	// topic's latest value, so the fallback must find it.
	got, found := h.GetMessageById("low/traffic", "aged-out-id", 1)
	if !found {
		t.Fatal("expected latest fallback to find the aged-out message")
	}
	if got.Id != "aged-out-id" {
		t.Errorf("unexpected message returned: %+v", got)
	}
}

func TestGetMessagesByIdsReturnsFoundSubset(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	base := int64(1_000_000)
	for i := 0; i < 30; i++ {
		m := msg("batch/t", 10)
		m.Id = fmt.Sprintf("id-%d", i)
		m.TimeMs = base + int64(i*10)
		h.addMessageToHistory(m)
	}

	ids := []string{"id-3", "no-such-id", "id-17", "id-29"}
	timesMs := []int64{base + 30, base + 999, base + 170, base + 290}
	got := h.GetMessagesByIds("batch/t", ids, timesMs)
	if len(got) != 3 {
		t.Fatalf("expected 3 found messages, got %d", len(got))
	}
	found := map[string]bool{}
	for _, m := range got {
		found[m.Id] = true
	}
	for _, want := range []string{"id-3", "id-17", "id-29"} {
		if !found[want] {
			t.Errorf("expected %s in result set, got %v", want, found)
		}
	}
}

func TestGetMessagesByIdsRejectsMismatchedSlices(t *testing.T) {
	h := newMessageHistory()
	h.SetBudgetBytes(10 * 1024 * 1024)
	h.addMessageToHistory(msg("a/b", 10))

	if got := h.GetMessagesByIds("a/b", []string{"x", "y"}, []int64{1}); got != nil {
		t.Errorf("expected nil for mismatched slice lengths, got %v", got)
	}
}
