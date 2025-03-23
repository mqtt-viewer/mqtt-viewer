package mqtt

import (
	"fmt"
	"log/slog"
)

func (mm *MqttManager) Disconnect(err *error) {
	slog.InfoContext(mm.ctx, "disconnecting mqtt client")
	mm.SetConnectionState(ConnectionStates.Disconnected, err)
	if mm.connection == nil {
		return
	}

	// Make sure the buffer isn't in use
	mm.MessageBuffer.mu.Lock()
	defer mm.MessageBuffer.mu.Unlock()

	if mm.connection.cancelConnect != nil {
		mm.connection.cancelConnect()
		mm.connection.cancelConnect = nil
		// return
	}

	if mm.connection.mqttVersion == "3" && mm.connection.v3Connection != nil {
		(*mm.connection.v3Connection).Disconnect(500)
		mm.connection.v3Connection = nil
	} else if mm.connection.mqttVersion == "5" && mm.connection.v5Connection != nil {
		(*mm.connection.v5Connection).Disconnect(mm.connection.connectionCtx)
		mm.connection.v5Connection = nil
	}
}

func newMqttDisconnectError(err error) error {
	return fmt.Errorf("disconnect: %w", err)
}
