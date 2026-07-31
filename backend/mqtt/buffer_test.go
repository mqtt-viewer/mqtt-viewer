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
