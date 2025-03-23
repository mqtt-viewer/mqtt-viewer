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

	go func() {
		mm.MessageHistory.addMessageToHistory(*m)
		mm.MessageBuffer.addMessageToBuffer(*m)
	}()

	mm.stats.ReceiveMessageToStats(*m)
	err = handleReceiveMiddleware(m, mm.middleware.AfterAddToHistory)
	if err != nil {
		return fmt.Errorf("after add to history: %w", err)
	}

	return nil
}
