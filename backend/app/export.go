package app

import (
	"encoding/json"
	"fmt"
	"mqtt-viewer/backend/mqtt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type exportedMessage struct {
	Topic      string                  `json:"topic"`
	Payload    string                  `json:"payload"`
	QoS        byte                    `json:"qos"`
	Retain     bool                    `json:"retain"`
	TimeMs     int64                   `json:"timeMs"`
	Time       string                  `json:"time"`
	Properties *mqtt.MessageProperties `json:"properties,omitempty"`
}

func (a *App) ExportTopicMessages(connId uint, topic string) (string, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return "", fmt.Errorf("connection not found")
	}
	history, err := appConnection.MqttManager.MessageHistory.GetTopicHistory(topic)
	if err != nil {
		return "", err
	}
	messages := toExportedMessages(history)
	defaultFilename := fmt.Sprintf("mqtt-messages-%s.json", strings.ReplaceAll(topic, "/", "-"))
	return a.saveMessagesToFile(messages, defaultFilename)
}

func (a *App) ExportAllMessages(connId uint) (string, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return "", fmt.Errorf("connection not found")
	}
	allHistory := appConnection.MqttManager.MessageHistory.GetAllHistory()
	messages := []exportedMessage{}
	for _, history := range allHistory {
		messages = append(messages, toExportedMessages(history)...)
	}
	sort.Slice(messages, func(i, j int) bool {
		return messages[i].TimeMs < messages[j].TimeMs
	})
	return a.saveMessagesToFile(messages, "mqtt-messages-all.json")
}

func (a *App) saveMessagesToFile(messages []exportedMessage, defaultFilename string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export message history",
		DefaultFilename: defaultFilename,
		Filters: []runtime.FileFilter{
			{
				DisplayName: "JSON Files (*.json)",
				Pattern:     "*.json",
			},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	data, err := json.MarshalIndent(messages, "", "  ")
	if err != nil {
		return "", err
	}
	err = os.WriteFile(path, data, 0644)
	if err != nil {
		return "", err
	}
	return path, nil
}

func toExportedMessages(history []mqtt.MqttMessage) []exportedMessage {
	messages := make([]exportedMessage, len(history))
	for i, message := range history {
		messages[i] = exportedMessage{
			Topic:      message.Topic,
			Payload:    string(message.Payload),
			QoS:        message.QoS,
			Retain:     message.Retain,
			TimeMs:     message.TimeMs,
			Time:       message.Time.Format(time.RFC3339Nano),
			Properties: message.Properties,
		}
	}
	return messages
}
