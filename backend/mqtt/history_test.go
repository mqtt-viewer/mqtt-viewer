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
	if h.totalBytes > h.budgetBytes {
		t.Errorf("totalBytes %d exceeds budget %d after eviction", h.totalBytes, h.budgetBytes)
	}
}

func TestHistoryKeepsLatestPerTopicAfterEviction(t *testing.T) {
	h := newMessageHistory()
	perMsg := estBytes(msg("x", 1024))
	// Budget for ~3 messages.
	h.SetBudgetBytes(int64(perMsg * 3))

	// One message on a low-traffic topic, then flood a different topic so the
	// low-traffic topic's only message ages out of the recent window.
	h.addMessageToHistory(msg("low/traffic", 1024))
	for i := 0; i < 20; i++ {
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
	h.SetBudgetBytes(int64(perMsg * 3))

	h.addMessageToHistory(msg("topic/a", 1024))
	for i := 0; i < 20; i++ {
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
	h.SetBudgetBytes(int64(perMsg * 3))

	// One $SYS message, then flood a different $SYS topic so the first ages out
	// of the recent window; its latest value must still be returned.
	h.addMessageToHistory(msg("$SYS/broker/uptime", 1024))
	for i := 0; i < 20; i++ {
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
	if h.totalBytes != 0 || len(h.recent) != 0 || h.head != 0 {
		t.Errorf("expected empty after clear, got bytes=%d recent=%d head=%d", h.totalBytes, len(h.recent), h.head)
	}
	if h.budgetBytes != 123456 {
		t.Errorf("expected budget preserved after clear, got %d", h.budgetBytes)
	}
	if _, err := h.GetTopicHistory("a"); err == nil {
		t.Error("expected topic-not-found after clear")
	}
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
