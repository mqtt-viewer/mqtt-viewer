package mqtt

import (
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// Backpressure caps for the drain buffer. Without them a slow drain (SQLite
// writer contention, prune storms) lets the buffer grow every tick with no
// upper bound, which is what produced multi-GB heaps and a frozen webview
// under sustained flood load. Once a cap is hit we load-shed the oldest
// buffered messages rather than let the batch, and therefore the drain, grow
// without limit.
const (
	maxBufferedMessages = 10000
	maxBufferedBytes    = 32 << 20 // 32 MiB, summed over buffered payloads
)

type MessageBuffer struct {
	mu           *sync.Mutex
	buffer       []MqttMessage
	bytes        int64
	dropped      uint64
	handleTicker *time.Ticker
	handleChan   chan bool
}

func newMessageBuffer() *MessageBuffer {
	return &MessageBuffer{
		mu:     &sync.Mutex{},
		buffer: []MqttMessage{},
	}
}

func (mb *MessageBuffer) StartHandlingBuffer(handleInterval time.Duration, cb func(messages []MqttMessage)) {
	mb.handleTicker = time.NewTicker(handleInterval)
	mb.handleChan = make(chan bool)

	go func() {
		for {
			select {
			case <-mb.handleChan:
				return
			case <-mb.handleTicker.C:
				mb.useBufferContents(cb)
			}
		}
	}()
}

func (mb *MessageBuffer) StopHandlingBuffer() {
	if mb.handleTicker != nil {
		mb.handleTicker.Stop()
		mb.handleTicker = nil
	}
	if mb.handleChan != nil {
		mb.handleChan <- true
		mb.handleChan = nil
	}
}

func (mb *MessageBuffer) useBufferContents(useContentsFunc func(messages []MqttMessage)) {
	// Snapshot and reset under the lock, then run the (possibly slow: event
	// emit + DB persist + prune) callback unlocked, so incoming messages aren't
	// blocked on the buffer mutex while a drain is in flight.
	mb.mu.Lock()
	messages := mb.buffer
	dropped := mb.dropped
	mb.buffer = []MqttMessage{}
	mb.bytes = 0
	mb.dropped = 0
	mb.mu.Unlock()

	if dropped > 0 {
		slog.Warn(fmt.Sprintf("message buffer overflow: dropped %d oldest messages", dropped))
	}
	if len(messages) > 0 {
		useContentsFunc(messages)
	}
}

func (mb *MessageBuffer) addMessageToBuffer(mqttMessage MqttMessage) {
	mb.mu.Lock()
	defer mb.mu.Unlock()

	mb.buffer = append(mb.buffer, mqttMessage)
	mb.bytes += int64(len(mqttMessage.Payload))

	for (len(mb.buffer) > maxBufferedMessages || mb.bytes > maxBufferedBytes) && len(mb.buffer) > 0 {
		oldest := mb.buffer[0]
		mb.buffer = mb.buffer[1:]
		mb.bytes -= int64(len(oldest.Payload))
		mb.dropped++
	}
}

func (mb *MessageBuffer) clearMessageBuffer() {
	mb.mu.Lock()
	defer mb.mu.Unlock()
	mb.buffer = []MqttMessage{}
	mb.bytes = 0
}
