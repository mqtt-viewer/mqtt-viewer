package mqtt

// Guards the relationship between estimatedBytes' accounted cost and real
// heap growth, so soft-memory-limit tuning (backend/app/memlimit.go) doesn't
// silently drift from what messages actually cost to retain.

import (
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHistoryCalibration(t *testing.T) {
	const n = 100000
	h := newMessageHistory()
	h.SetBudgetBytes(1 << 40) // effectively unbounded so nothing evicts

	runtime.GC()
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	now := time.Now()
	for i := 0; i < n; i++ {
		payload := []byte(fmt.Sprintf(`{"value": %d.%03d, "unit": "C", "seq": %d}`, i%100, i%1000, i))
		msg := MqttMessage{
			Id:      uuid.NewString(),
			Topic:   fmt.Sprintf("telemetry/group-%03d/device-%04d/temperature", i%50, i%2000),
			Payload: payload,
			QoS:     0,
			TimeMs:  now.UnixMilli() + int64(i),
			Time:    now,
		}
		h.addMessageToHistory(msg)
	}

	runtime.GC()
	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)

	realBytes := float64(after.HeapAlloc - before.HeapAlloc)
	accounted := float64(h.totalBytes)
	ratio := realBytes / accounted

	if ratio < 0.3 || ratio > 1.5 {
		t.Fatalf(
			"estimatedBytes has drifted from real heap cost: real/accounted ratio %.2f (real %.0f B/msg, accounted %.0f B/msg) is outside the expected [0.3, 1.5] band — recalibrate estimatedBytes in message.go and refresh the comment above it",
			ratio, realBytes/n, accounted/n,
		)
	}
}
