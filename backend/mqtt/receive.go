package mqtt

import (
	"fmt"
)

// receiveMessage runs on every incoming message; keep it log-free. A debug
// line here means thousands of formatted log writes per second on a busy
// broker, which alone lags the app in dev mode.
func (mm *MqttManager) receiveMessage(m *MqttMessage) error {
	err := handleReceiveMiddleware(m, mm.middleware.BeforeAddToHistory)
	if err != nil {
		return fmt.Errorf("before add to history: %w", err)
	}

	mm.MessageHistory.addMessageToHistory(*m)
	mm.MessageBuffer.addMessageToBuffer(*m)

	mm.stats.ReceiveMessageToStats(*m)
	err = handleReceiveMiddleware(m, mm.middleware.AfterAddToHistory)
	if err != nil {
		return fmt.Errorf("after add to history: %w", err)
	}

	return nil
}
