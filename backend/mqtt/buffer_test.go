package mqtt

import (
	"sync"
	"testing"
	"time"
)

// Regression test for a crash on disconnect under load: StopHandlingBuffer
// used to nil handleTicker while the handler goroutine re-read the field in
// its select, dereferencing a nil ticker. Run with -race to catch the field
// race even on runs where the nil dereference itself doesn't fire.
func TestStopHandlingBufferWhileHandlerBusy(t *testing.T) {
	for i := 0; i < 200; i++ {
		mb := newMessageBuffer()
		mb.StartHandlingBuffer(time.Microsecond, func(messages []MqttMessage) {})

		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				mb.addMessageToBuffer(MqttMessage{})
			}
		}()

		mb.StopHandlingBuffer()
		wg.Wait()
	}
}

func TestStopHandlingBufferIsIdempotent(t *testing.T) {
	mb := newMessageBuffer()
	mb.StartHandlingBuffer(time.Millisecond, func(messages []MqttMessage) {})
	mb.StopHandlingBuffer()
	mb.StopHandlingBuffer()
}

func TestNoHandleAfterStop(t *testing.T) {
	mb := newMessageBuffer()
	var mu sync.Mutex
	calls := 0
	mb.StartHandlingBuffer(100*time.Microsecond, func(messages []MqttMessage) {
		mu.Lock()
		calls++
		mu.Unlock()
	})
	mb.addMessageToBuffer(MqttMessage{})
	time.Sleep(2 * time.Millisecond)
	mb.StopHandlingBuffer()

	mu.Lock()
	after := calls
	mu.Unlock()

	mb.addMessageToBuffer(MqttMessage{})
	time.Sleep(2 * time.Millisecond)

	mu.Lock()
	final := calls
	mu.Unlock()
	if final != after {
		t.Fatalf("handler ran after StopHandlingBuffer: %d calls before, %d after", after, final)
	}
}

func bufMsg(seq int, payloadLen int) MqttMessage {
	return MqttMessage{
		Topic:   "t",
		Payload: make([]byte, payloadLen),
		TimeMs:  int64(seq),
	}
}

func TestBufferDropsOldestOverCountCap(t *testing.T) {
	mb := newMessageBuffer()

	const extra = 500
	for i := 0; i < maxBufferedMessages+extra; i++ {
		mb.addMessageToBuffer(bufMsg(i, 8)) // tiny payloads: only the count cap binds
	}

	var drained []MqttMessage
	mb.useBufferContents(func(messages []MqttMessage) {
		drained = messages
	})

	if len(drained) != maxBufferedMessages {
		t.Fatalf("expected %d messages retained, got %d", maxBufferedMessages, len(drained))
	}
	// The retained slice is the newest cap-sized suffix, in arrival order.
	if drained[0].TimeMs != extra {
		t.Errorf("expected oldest retained TimeMs %d, got %d", extra, drained[0].TimeMs)
	}
	if last := drained[len(drained)-1].TimeMs; last != int64(maxBufferedMessages+extra-1) {
		t.Errorf("expected newest retained TimeMs %d, got %d", maxBufferedMessages+extra-1, last)
	}
}

func TestBufferDropsOldestOverByteCap(t *testing.T) {
	mb := newMessageBuffer()

	// A handful of large payloads that individually fit but together exceed
	// maxBufferedBytes, so the byte cap binds well before the count cap.
	const payloadLen = 10 << 20 // 10 MiB
	n := int(maxBufferedBytes/payloadLen) + 3
	for i := 0; i < n; i++ {
		mb.addMessageToBuffer(bufMsg(i, payloadLen))
	}

	var drained []MqttMessage
	var drainedBytes int64
	mb.useBufferContents(func(messages []MqttMessage) {
		drained = messages
		for _, m := range messages {
			drainedBytes += int64(len(m.Payload))
		}
	})

	if len(drained) == 0 || len(drained) >= n {
		t.Fatalf("expected some but not all messages evicted, got %d of %d", len(drained), n)
	}
	if drainedBytes > maxBufferedBytes {
		t.Errorf("expected retained bytes within cap, got %d > %d", drainedBytes, maxBufferedBytes)
	}
	// Newest arrivals are kept.
	if last := drained[len(drained)-1].TimeMs; last != int64(n-1) {
		t.Errorf("expected newest retained TimeMs %d, got %d", n-1, last)
	}
}

func TestBufferDroppedCounterResetsOnDrain(t *testing.T) {
	mb := newMessageBuffer()
	for i := 0; i < maxBufferedMessages+10; i++ {
		mb.addMessageToBuffer(bufMsg(i, 8))
	}
	if mb.dropped != 10 {
		t.Fatalf("expected dropped counter at 10 before drain, got %d", mb.dropped)
	}

	mb.useBufferContents(func(messages []MqttMessage) {})

	mb.mu.Lock()
	dropped := mb.dropped
	mb.mu.Unlock()
	if dropped != 0 {
		t.Errorf("expected dropped counter reset after drain, got %d", dropped)
	}
}

func TestBufferUnderCapsRetainsEverything(t *testing.T) {
	mb := newMessageBuffer()
	for i := 0; i < 100; i++ {
		mb.addMessageToBuffer(bufMsg(i, 64))
	}
	var drained []MqttMessage
	mb.useBufferContents(func(messages []MqttMessage) {
		drained = messages
	})
	if len(drained) != 100 {
		t.Errorf("expected all 100 messages retained under cap, got %d", len(drained))
	}
}
