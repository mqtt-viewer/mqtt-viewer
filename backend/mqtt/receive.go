package mqtt

import (
	"fmt"
	"log/slog"
)

func (mm *MqttManager) receiveMessage(m *MqttMessage) error {
	slog.DebugContext(mm.ctx, "received message", slog.String("topic", m.Topic))
	err := handleReceiveMiddleware(m, mm.middleware.BeforeAddToHistory)
	if err != nil {
		return fmt.Errorf("before add to history: %w", err)
	}

	// Written on the caller's goroutine, in order. History and the buffer are
	// append-ordered and the timeline renders them in that order, so handing
	// each message to its own goroutine let them land shuffled. Both writes are
	// a mutex and an append, so doing them here costs about a microsecond and
	// saves spawning a goroutine per message.
	//
	// The trade-off: paho calls us from the goroutine reading the connection,
	// so anything slow here is backpressure on that socket rather than a pile
	// of queued goroutines. The one caller that can hold the history mutex for
	// a noticeable stretch is ExportAllMessages via GetAllHistory, around
	// 150ms with a full 512MB window. That is well inside the keepalive budget
	// (20s keepalive plus a 10s ping timeout), so it stalls reading briefly and
	// recovers. Keep it that way: work that could block for seconds does not
	// belong on this path.
	mm.MessageHistory.addMessageToHistory(*m)
	mm.MessageBuffer.addMessageToBuffer(*m)

	mm.stats.receiveMessageToStats(*m)
	err = handleReceiveMiddleware(m, mm.middleware.AfterAddToHistory)
	if err != nil {
		return fmt.Errorf("after add to history: %w", err)
	}

	return nil
}
