package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/sparkplug"
	"time"
)

// maxSparkplugHistoryMessages caps the mount replay defensively. Births and
// STATE are kept in full, and a fleet large enough to blow through this is one
// where a complete replay would stall the panel anyway, so keep the newest and
// drop the rest.
const maxSparkplugHistoryMessages = 10000

// GetSparkplugMessageHistory returns the retained Sparkplug messages a view
// needs to rebuild its tree (the spBv1.0 namespace plus legacy root-level STATE
// topics), sorted by arrival time, so a Sparkplug view opened mid-session can
// replay births received earlier.
func (a *App) GetSparkplugMessageHistory(connectionId uint) ([]mqtt.MqttMessage, error) {
	appConnection, ok := a.AppConnections[connectionId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connectionId)
	}
	history := appConnection.MqttManager.MessageHistory
	messages := history.GetHistoryByTopicPrefix("spBv1.0/")
	messages = append(messages, history.GetHistoryByTopicPrefix("STATE/")...)
	return narrowSparkplugHistory(messages), nil
}

// narrowSparkplugHistory keeps every birth (each one establishes the aliases
// later data depends on) and every STATE, but only the latest message per other
// topic. The full window can run to hundreds of thousands of NDATA messages the
// frontend then base64-decodes and parses one at a time on panel mount, and all
// but the last of those is redundant for building the tree. Topics that fail
// the Sparkplug grammar fall in the latest-per-topic bucket. Returns the result
// sorted by arrival time ascending.
func narrowSparkplugHistory(messages []mqtt.MqttMessage) []mqtt.MqttMessage {
	kept := make([]mqtt.MqttMessage, 0, len(messages))
	latestIndex := map[string]int{}
	for _, message := range messages {
		if info, ok := sparkplug.ParseTopic(message.Topic); ok {
			switch info.Type {
			case sparkplug.MessageTypeNBirth, sparkplug.MessageTypeDBirth, sparkplug.MessageTypeState:
				kept = append(kept, message)
				continue
			}
		}
		if index, ok := latestIndex[message.Topic]; ok {
			if message.TimeMs >= kept[index].TimeMs {
				kept[index] = message
			}
			continue
		}
		latestIndex[message.Topic] = len(kept)
		kept = append(kept, message)
	}
	sortMessagesByTimeAsc(kept)
	if len(kept) > maxSparkplugHistoryMessages {
		kept = kept[len(kept)-maxSparkplugHistoryMessages:]
	}
	return kept
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
