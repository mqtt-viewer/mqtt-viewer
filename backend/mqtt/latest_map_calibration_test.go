package mqtt

// Guards the relationship between what a pinned latest-per-topic entry is
// charged (message bytes + latestEntryOverhead) and what it actually costs on
// the heap, so the topic-cardinality bound doesn't silently drift from real
// memory use.

import (
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLatestMapCalibration(t *testing.T) {
	const topics = 20000
	h := newMessageHistory()
	h.SetBudgetBytes(1 << 40) // effectively unbounded; we drive eviction by hand

	runtime.GC()
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	now := time.Now()
	for i := 0; i < topics; i++ {
		h.addMessageToHistory(MqttMessage{
			Id:      uuid.NewString(),
			Topic:   fmt.Sprintf("telemetry/group-%03d/device-%06d/temperature", i%50, i),
			Payload: []byte(fmt.Sprintf(`{"value": %d.%03d, "unit": "C"}`, i%100, i%1000)),
			TimeMs:  now.UnixMilli() + int64(i),
			Time:    now,
		})
	}

	// Age every message out of the recent window so the latest map is the sole
	// holder, then drop the window itself. What survives the GC below is the
	// latest map and nothing else, which is exactly what latestBytes claims.
	for h.head < len(h.recent) {
		h.evictOldestRecentLocked()
	}
	h.recent = nil
	h.head = 0
	h.recentBytes = 0
	if len(h.latest) != topics {
		t.Fatalf("expected %d pinned topics, got %d", topics, len(h.latest))
	}

	runtime.GC()
	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)

	realBytes := float64(after.HeapAlloc - before.HeapAlloc)
	accounted := float64(h.latestBytes)
	ratio := realBytes / accounted

	t.Logf("latest map: %d topics, real %.0f B/topic, accounted %.0f B/topic (ratio %.2f)",
		topics, realBytes/topics, accounted/topics, ratio)

	if ratio < 0.3 || ratio > 1.5 {
		t.Fatalf(
			"latest-map accounting has drifted from real heap cost: real/accounted ratio %.2f (real %.0f B/topic, accounted %.0f B/topic) is outside the expected [0.3, 1.5] band — recalibrate latestEntryOverhead in history.go",
			ratio, realBytes/topics, accounted/topics,
		)
	}
}
