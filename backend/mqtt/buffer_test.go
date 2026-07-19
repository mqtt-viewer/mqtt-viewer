package mqtt

import "testing"

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
