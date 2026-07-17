package mqtt

import (
	"fmt"
	"testing"
	"time"
)

// The retained index adds work to addMessageToHistory, which is the ingest path
// for every message from every broker (the perf bar is two brokers at ~2000
// msg/s each). These measure that the added work is a non-event.

func benchMessages(n int, retained bool) []MqttMessage {
	msgs := make([]MqttMessage, n)
	for i := 0; i < n; i++ {
		m := msg(fmt.Sprintf("factory/line%d/sensor%d/temperature", i%8, i%64), 128)
		m.Retain = retained
		m.TimeMs = time.Now().UnixMilli()
		msgs[i] = m
	}
	return msgs
}

// Ordinary traffic: the overwhelmingly common case. The retained branch should
// exit immediately on the Retain check.
func BenchmarkAddMessageNonRetained(b *testing.B) {
	msgs := benchMessages(1024, false)
	h := newMessageHistory()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.addMessageToHistory(msgs[i%len(msgs)])
	}
}

// Every message retained: the worst case for the index, where each one writes
// to the map.
func BenchmarkAddMessageRetained(b *testing.B) {
	msgs := benchMessages(1024, true)
	h := newMessageHistory()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.addMessageToHistory(msgs[i%len(msgs)])
	}
}
