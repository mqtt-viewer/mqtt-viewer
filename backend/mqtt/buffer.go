package mqtt

import (
	"sync"
	"time"
)

type MessageBuffer struct {
	mu           *sync.Mutex
	buffer       []MqttMessage
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
	mb.mu.Lock()
	defer mb.mu.Unlock()
	useContentsFunc(mb.buffer)
	mb.buffer = []MqttMessage{}
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
