package mqtt

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// receiveN feeds messages through receiveMessage the way the MQTT 5 client
// does: one at a time, in arrival order, from a single goroutine.
func receiveN(t *testing.T, mm *MqttManager, topic string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		m := &MqttMessage{
			Topic:   topic,
			Payload: []byte(fmt.Sprintf("%d", i)),
			TimeMs:  int64(i),
		}
		if err := mm.receiveMessage(m); err != nil {
			t.Fatalf("receiveMessage %d: %v", i, err)
		}
	}
}

// waitForHistory waits until the topic has n messages, so the test still works
// if the writes are done asynchronously.
func waitForHistory(t *testing.T, mm *MqttManager, topic string, n int) []MqttMessage {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		history, err := mm.MessageHistory.GetTopicHistory(topic)
		if err == nil && len(history) >= n {
			return history
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %d messages, got %d (err=%v)", n, len(history), err)
		}
		time.Sleep(time.Millisecond)
	}
}

// The timeline and per-topic history are rendered in the order messages were
// appended, so receiveMessage must not reorder them.
func TestReceiveMessageKeepsHistoryInArrivalOrder(t *testing.T) {
	mm := NewMqttManager(context.Background(), nil)
	const n = 2000
	const topic = "order/history"

	receiveN(t, mm, topic, n)
	history := waitForHistory(t, mm, topic, n)

	if len(history) != n {
		t.Fatalf("expected %d messages, got %d", n, len(history))
	}
	for i, msg := range history {
		if msg.TimeMs != int64(i) {
			t.Fatalf("message %d out of order: TimeMs = %d, want %d", i, msg.TimeMs, i)
		}
	}
}

// The buffer feeds the 300ms drain that emits to the frontend and persists to
// disk, so it has to stay in arrival order too.
func TestReceiveMessageKeepsBufferInArrivalOrder(t *testing.T) {
	mm := NewMqttManager(context.Background(), nil)
	const n = 2000
	const topic = "order/buffer"

	receiveN(t, mm, topic, n)
	// Drain once the history shows every message, by which point the buffer
	// writes for those messages have been made too.
	waitForHistory(t, mm, topic, n)

	var drained []MqttMessage
	mm.MessageBuffer.useBufferContents(func(messages []MqttMessage) {
		drained = messages
	})

	if len(drained) != n {
		t.Fatalf("expected %d buffered messages, got %d", n, len(drained))
	}
	for i, msg := range drained {
		if msg.TimeMs != int64(i) {
			t.Fatalf("buffered message %d out of order: TimeMs = %d, want %d", i, msg.TimeMs, i)
		}
	}
}
