package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/protobuf"
	"mqtt-viewer/backend/sparkplug"
	"sort"
	"time"
)

// SparkplugHistory is what a Sparkplug view replays to rebuild its tree.
// SuspendedOrd is the arrival order (the meta "n") of the connection's last
// drop: births with a lower order predate it and their names are unverified.
type SparkplugHistory struct {
	Messages     []mqtt.MqttMessage `json:"messages"`
	SuspendedOrd uint64             `json:"suspendedOrd"`
}

// GetSparkplugMessageHistory returns the messages a Sparkplug view needs to
// rebuild the current tree, in arrival order, so a view opened mid-session
// starts from the state it would have reached watching live.
//
// It is not a window of recent traffic. Sparkplug reports by exception, so
// the latest NDATA for a node usually carries only the metrics that just
// changed, and replaying a tail of the history would leave every quieter
// metric on its birth value. The current births and deaths come from the
// session store, which keeps them, and metric values from its latest-value
// index, rebuilt into one data message per original message: the message a
// quiet metric last changed in, or a quiet node's birth, may be long gone
// from history. Older NBIRTHs, seq-gap messages and host STATE are fetched
// from history by id, best effort.
func (a *App) GetSparkplugMessageHistory(connectionId uint) (SparkplugHistory, error) {
	appConnection, ok := a.appConnection(connectionId)
	if !ok {
		return SparkplugHistory{}, fmt.Errorf("connection not found (%d)", connectionId)
	}
	return replaySparkplugHistory(appConnection.SparkplugStore, appConnection.MqttManager.MessageHistory), nil
}

// GetSparkplugSuspendedOrd returns the arrival order (the meta "n") at the
// connection's last drop. A view asks for it on reconnect: messages received
// just before a drop can still be delivered after it, and must not count as
// signs of life since.
func (a *App) GetSparkplugSuspendedOrd(connectionId uint) (uint64, error) {
	appConnection, ok := a.appConnection(connectionId)
	if !ok {
		return 0, fmt.Errorf("connection not found (%d)", connectionId)
	}
	return appConnection.SparkplugStore.SuspendedOrd(), nil
}

// replaySparkplugHistory resolves the store's replay against history. A ref
// whose message has aged out of the history window is skipped.
func replaySparkplugHistory(store *sparkplug.SessionStore, history *mqtt.MessageHistory) SparkplugHistory {
	replay := store.Replay()
	type topicRefs struct {
		ids     []string
		timesMs []int64
	}
	byTopic := map[string]*topicRefs{}
	ordByID := map[string]uint64{}
	for _, ref := range replay.Refs {
		refs, ok := byTopic[ref.Topic]
		if !ok {
			refs = &topicRefs{}
			byTopic[ref.Topic] = refs
		}
		refs.ids = append(refs.ids, ref.ID)
		refs.timesMs = append(refs.timesMs, ref.TimeMs)
		ordByID[ref.ID] = ref.Ord
	}
	type ordered struct {
		ord uint64
		msg mqtt.MqttMessage
	}
	all := []ordered{}
	for topic, refs := range byTopic {
		for _, msg := range history.GetMessagesByIds(topic, refs.ids, refs.timesMs) {
			all = append(all, ordered{ordByID[msg.Id], msg})
		}
	}
	for _, data := range replay.Data {
		payload, err := protobuf.MarshalDynamicToJSON(data.Payload)
		if err != nil {
			continue
		}
		props := map[string]any{"IsDecodedProto": true, "sparkplug": data.Meta}
		all = append(all, ordered{data.Ord, mqtt.MqttMessage{
			// The original message's id, so "open the message this value came
			// from" finds it in history (when history still has it).
			Id:                   data.ID,
			Topic:                data.Topic,
			Payload:              payload,
			TimeMs:               data.TimeMs,
			Time:                 time.UnixMilli(data.TimeMs),
			MiddlewareProperties: &props,
		}})
	}
	// Arrival order, not time order: messages in one millisecond are routine
	// during a node's connect burst, and a birth must come before its data.
	sort.Slice(all, func(i, j int) bool { return all[i].ord < all[j].ord })
	out := SparkplugHistory{Messages: make([]mqtt.MqttMessage, len(all)), SuspendedOrd: replay.SuspendedOrd}
	for i, o := range all {
		out.Messages[i] = o.msg
	}
	return out
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
