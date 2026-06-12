package mqtt

import (
	"fmt"
	"sync"
)

type MessageHistory struct {
	mutex   *sync.Mutex
	history map[string][]MqttMessage
}

func newMessageHistory() *MessageHistory {
	return &MessageHistory{
		mutex:   &sync.Mutex{},
		history: make(map[string][]MqttMessage),
	}
}

func (m *MessageHistory) GetTopicHistory(topic string) ([]MqttMessage, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	history, ok := (*m).history[topic]
	if !ok {
		return nil, fmt.Errorf("topic not found in message history")
	}
	return history, nil
}

func (m *MessageHistory) GetAllHistory() map[string][]MqttMessage {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	historyCopy := make(map[string][]MqttMessage, len((*m).history))
	for topic, messages := range (*m).history {
		messagesCopy := make([]MqttMessage, len(messages))
		copy(messagesCopy, messages)
		historyCopy[topic] = messagesCopy
	}
	return historyCopy
}

func (m *MessageHistory) addMessageToHistory(message MqttMessage) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	(*m).history[message.Topic] = append((*m).history[message.Topic], message)
}
