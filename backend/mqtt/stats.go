package mqtt

import "sync/atomic"

// ConnectionStats is the snapshot handed to the frontend by GetStats. It is a
// plain value type so the counters can never be read while a message is
// updating them.
type ConnectionStats struct {
	MessagesReceived int `json:"messagesReceived"`
	MessagesSent     int `json:"messagesSent"`
	BytesReceived    int `json:"bytesReceived"`
	BytesSent        int `json:"bytesSent"`
}

// connectionStats holds the live counters. The paho v3 router dispatches every
// incoming message on its own goroutine (order=false), so receives land here
// concurrently. Atomics rather than a mutex: this sits on the receive hot path
// and the four counters never need to move as one consistent set.
type connectionStats struct {
	messagesReceived atomic.Int64
	messagesSent     atomic.Int64
	bytesReceived    atomic.Int64
	bytesSent        atomic.Int64
}

func newStats() *connectionStats {
	return &connectionStats{}
}

func (s *connectionStats) receiveMessageToStats(message MqttMessage) {
	s.messagesReceived.Add(1)
	s.bytesReceived.Add(int64(len(message.Payload)))
}

func (s *connectionStats) sendMessageToStats(message MqttPublishParams) {
	s.messagesSent.Add(1)
	s.bytesSent.Add(int64(len(message.Payload)))
}

// snapshot reads the counters for the 1s frontend poll. The loads are four
// separate atomic reads, not one atomic set, so a snapshot taken mid-message
// can carry the message count without its bytes; the next poll corrects it.
func (s *connectionStats) snapshot() ConnectionStats {
	return ConnectionStats{
		MessagesReceived: int(s.messagesReceived.Load()),
		MessagesSent:     int(s.messagesSent.Load()),
		BytesReceived:    int(s.bytesReceived.Load()),
		BytesSent:        int(s.bytesSent.Load()),
	}
}
