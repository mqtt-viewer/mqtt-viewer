package mqtt

type ConnectionStats struct {
	MessagesReceived int `json:"messagesReceived"`
	MessagesSent     int `json:"messagesSent"`
	BytesReceived    int `json:"bytesReceived"`
	BytesSent        int `json:"bytesSent"`
}

func newStats() *ConnectionStats {
	return &ConnectionStats{}
}

func (s *ConnectionStats) ReceiveMessageToStats(message MqttMessage) {
	s.MessagesReceived++
	s.BytesReceived += len(message.Payload)
}

func (s *ConnectionStats) SendMessageToStats(message MqttPublishParams) {
	s.MessagesSent++
	s.BytesSent += len(message.Payload)
}
