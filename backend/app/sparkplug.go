package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/sparkplug"
	"time"
)

// GetSparkplugMessageHistory returns the retained messages a Sparkplug view
// needs to rebuild its tree, sorted by arrival time, so a view opened
// mid-session starts from the same state it would have reached watching live.
//
// It is not a window of recent traffic. Sparkplug reports by exception, so the
// latest NDATA for a node usually carries only the metrics that just changed,
// and replaying a tail of the history would leave every quieter metric on its
// birth value. The session store instead indexes, as messages arrive, the
// latest message carrying each metric, plus each scope's latest birth and
// death, recent NBIRTHs (for rebirth-storm counts), recent seq-gap messages
// and each host's latest STATE. That set is bounded by the store's caps, not
// by how long the session has run, and each message is fetched by id with a
// time hint rather than by scanning the window.
func (a *App) GetSparkplugMessageHistory(connectionId uint) ([]mqtt.MqttMessage, error) {
	appConnection, ok := a.appConnection(connectionId)
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connectionId)
	}
	return replaySparkplugHistory(appConnection.SparkplugStore, appConnection.MqttManager.MessageHistory), nil
}

// replaySparkplugHistory resolves the store's replay refs against history.
// A ref whose message has aged out of the history window is skipped.
func replaySparkplugHistory(store *sparkplug.SessionStore, history *mqtt.MessageHistory) []mqtt.MqttMessage {
	type topicRefs struct {
		ids     []string
		timesMs []int64
	}
	byTopic := map[string]*topicRefs{}
	for _, ref := range store.ReplayRefs() {
		refs, ok := byTopic[ref.Topic]
		if !ok {
			refs = &topicRefs{}
			byTopic[ref.Topic] = refs
		}
		refs.ids = append(refs.ids, ref.ID)
		refs.timesMs = append(refs.timesMs, ref.TimeMs)
	}
	messages := []mqtt.MqttMessage{}
	for topic, refs := range byTopic {
		messages = append(messages, history.GetMessagesByIds(topic, refs.ids, refs.timesMs)...)
	}
	sortMessagesByTimeAsc(messages)
	return messages
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
	if connection.IsProtoEnabled == nil || !*connection.IsProtoEnabled || a.protoRegistry() == nil {
		return fmt.Errorf("rebirth requests need protobuf decoding enabled on the connection")
	}
	return a.PublishMqtt(connectionId, PublishParams{
		Topic:   sparkplug.RebirthTopic(group, edgeNode),
		QoS:     0,
		Payload: sparkplug.RebirthPayloadJSON(time.Now().UnixMilli()),
		Retain:  false,
	})
}
