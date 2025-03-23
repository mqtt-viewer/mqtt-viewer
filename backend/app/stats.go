package app

import "mqtt-viewer/backend/mqtt"

type MqttStats struct {
	TotalMessagesReceived int                           `json:"totalMessagesReceived"`
	TotalMessagesSent     int                           `json:"totalMessagesSent"`
	TotalBytesReceived    int                           `json:"totalBytesReceived"`
	TotalBytesSent        int                           `json:"totalBytesSent"`
	StatsByConnection     map[uint]mqtt.ConnectionStats `json:"statsByConnection"`
}

func (a *App) GetMqttStats() (MqttStats, error) {
	stats := MqttStats{
		StatsByConnection: make(map[uint]mqtt.ConnectionStats),
	}
	for _, c := range a.AppConnections {
		connStats := c.MqttManager.GetStats()
		stats.StatsByConnection[c.Connection.ID] = connStats
		stats.TotalMessagesReceived += connStats.MessagesReceived
		stats.TotalMessagesSent += connStats.MessagesSent
		stats.TotalBytesReceived += connStats.BytesReceived
		stats.TotalBytesSent += connStats.BytesSent
	}
	return stats, nil
}
