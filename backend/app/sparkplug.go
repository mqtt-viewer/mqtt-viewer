package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/sparkplug"
	"time"
)

// GetSparkplugMessageHistory returns every retained Sparkplug message for a
// connection (the spBv1.0 namespace plus legacy root-level STATE topics),
// flattened across topics and sorted by arrival time, so a Sparkplug view
// opened mid-session can replay births received earlier.
func (a *App) GetSparkplugMessageHistory(connectionId uint) ([]mqtt.MqttMessage, error) {
	appConnection, ok := a.AppConnections[connectionId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connectionId)
	}
	history := appConnection.MqttManager.MessageHistory
	messages := history.GetHistoryByTopicPrefix("spBv1.0/")
	messages = append(messages, history.GetHistoryByTopicPrefix("STATE/")...)
	sortMessagesByTimeAsc(messages)
	return messages, nil
}

// PublishSparkplugRebirth publishes the standard NCMD Node Control/Rebirth
// request for an edge node. It routes through PublishMqtt so the proto-encode
// publish middleware turns the JSON body into a Sparkplug B protobuf payload,
// which is why the connection must have protobuf decoding enabled.
func (a *App) PublishSparkplugRebirth(connectionId uint, group string, edgeNode string) error {
	if group == "" || edgeNode == "" {
		return fmt.Errorf("group and edge node are required for a rebirth request")
	}
	if _, err := getConnectedConnection(a, connectionId); err != nil {
		return err
	}
	connection := models.Connection{}
	if err := a.Db.First(&connection, connectionId).Error; err != nil {
		return err
	}
	// Mirrors the ConnectMqtt condition for registering the encode middleware:
	// without it the payload would be published as raw JSON.
	if connection.IsProtoEnabled == nil || !*connection.IsProtoEnabled || a.ProtoRegistry == nil {
		return fmt.Errorf("rebirth requests need protobuf decoding enabled on the connection")
	}
	return a.PublishMqtt(connectionId, PublishParams{
		Topic:   sparkplug.RebirthTopic(group, edgeNode),
		QoS:     0,
		Payload: sparkplug.RebirthPayloadJSON(time.Now().UnixMilli()),
		Retain:  false,
	})
}
