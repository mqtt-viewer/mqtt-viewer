package app

import "mqtt-viewer/backend/mqtt"

type MemoryStats struct {
	HistoryBytes      int64 `json:"historyBytes"`
	ActiveConnections int   `json:"activeConnections"`
}

// GetMemoryStats reports how much estimated memory in-RAM message history is
// using across all connections. A disconnected connection still holds its
// history against the budget, so it counts as active while it has any.
func (a *App) GetMemoryStats() MemoryStats {
	stats := MemoryStats{}
	for _, c := range a.AppConnections {
		historyBytes := c.MqttManager.HistoryBytes()
		stats.HistoryBytes += historyBytes
		if c.MqttManager.ConnectionState == mqtt.ConnectionStates.Connected ||
			historyBytes > 0 {
			stats.ActiveConnections++
		}
	}
	return stats
}
