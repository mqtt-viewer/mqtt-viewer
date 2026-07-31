package mqtt

import (
	"sync"
	"time"
)

type MessageBuffer struct {
	mu     *sync.Mutex
	buffer []MqttMessage

	// handleMu guards the two lifecycle fields below. The handler goroutine
	// never reads them; it works off locals captured at start.
	handleMu     sync.Mutex
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
	mb.handleMu.Lock()
	defer mb.handleMu.Unlock()

	if mb.handleChan != nil {
		// Already running; callers stop before restarting.
		return
	}

	ticker := time.NewTicker(handleInterval)
	done := make(chan bool)
	mb.handleTicker = ticker
	mb.handleChan = done

	go func() {
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				mb.useBufferContents(cb)
			}
		}
	}()
}

func (mb *MessageBuffer) StopHandlingBuffer() {
	mb.handleMu.Lock()
	defer mb.handleMu.Unlock()

	if mb.handleChan == nil {
		return
	}

	// The unbuffered send blocks until the handler goroutine takes it, so the
	// goroutine is guaranteed out of its select before the fields are cleared.
	mb.handleChan <- true
	mb.handleTicker.Stop()
	mb.handleTicker = nil
	mb.handleChan = nil
}

func (mb *MessageBuffer) useBufferContents(useContentsFunc func(messages []MqttMessage)) {
	// Snapshot and reset under the lock, then run the (possibly slow: event
	// emit + DB persist + prune) callback unlocked, so incoming messages aren't
	// blocked on the buffer mutex while a drain is in flight.
	mb.mu.Lock()
	messages := mb.buffer
	mb.buffer = []MqttMessage{}
	mb.mu.Unlock()
	if len(messages) > 0 {
		useContentsFunc(messages)
	}
}

func (mb *MessageBuffer) addMessageToBuffer(mqttMessage MqttMessage) {
	mb.mu.Lock()
	defer mb.mu.Unlock()

	mb.buffer = append(mb.buffer, mqttMessage)
}

func (mb *MessageBuffer) clearMessageBuffer() {
	mb.mu.Lock()
	defer mb.mu.Unlock()
	mb.buffer = []MqttMessage{}
}
