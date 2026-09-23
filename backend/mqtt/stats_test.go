package mqtt

import (
	"sync"
	"testing"
)

// Receives arrive one goroutine per message from the paho v3 router, so the
// counters have to survive concurrent updates. Unsynchronised increments lose
// updates here even without the race detector.
func TestStatsCountEveryConcurrentMessage(t *testing.T) {
	const goroutines = 8
	const perGoroutine = 500
	const payloadBytes = 4

	stats := newStats()
	message := MqttMessage{Payload: make([]byte, payloadBytes)}
	publish := MqttPublishParams{Payload: make([]byte, payloadBytes)}

	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				stats.receiveMessageToStats(message)
			}
		}()
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				stats.sendMessageToStats(publish)
			}
		}()
	}
	wg.Wait()

	wantMessages := goroutines * perGoroutine
	wantBytes := wantMessages * payloadBytes
	got := stats.snapshot()
	if got.MessagesReceived != wantMessages {
		t.Errorf("MessagesReceived = %d, want %d", got.MessagesReceived, wantMessages)
	}
	if got.MessagesSent != wantMessages {
		t.Errorf("MessagesSent = %d, want %d", got.MessagesSent, wantMessages)
	}
	if got.BytesReceived != wantBytes {
		t.Errorf("BytesReceived = %d, want %d", got.BytesReceived, wantBytes)
	}
	if got.BytesSent != wantBytes {
		t.Errorf("BytesSent = %d, want %d", got.BytesSent, wantBytes)
	}
}

// The 1s frontend poll reads the counters while messages are still landing.
func TestStatsSnapshotWhileCounting(t *testing.T) {
	stats := newStats()
	message := MqttMessage{Payload: []byte("payload")}

	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 2000; i++ {
			stats.receiveMessageToStats(message)
		}
		close(done)
	}()

	for {
		select {
		case <-done:
			wg.Wait()
			if got := stats.snapshot(); got.MessagesReceived != 2000 {
				t.Errorf("MessagesReceived = %d, want 2000", got.MessagesReceived)
			}
			return
		default:
			stats.snapshot()
		}
	}
}
