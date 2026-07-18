package app

import (
	"encoding/json"
	"fmt"
	"mqtt-viewer/backend/mqtt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
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

// ExportedMessagesPayload carries an export's JSON and its default filename to
// the frontend, so a browser build can trigger a download instead of using the
// native save dialog (which is a no-op headless in server mode).
type ExportedMessagesPayload struct {
	Filename string `json:"filename"`
	Json     string `json:"json"`
}

func (a *App) ExportTopicMessages(connId uint, topic string) (string, error) {
	messages, filename, err := a.collectTopicMessages(connId, topic)
	if err != nil {
		return "", err
	}
	return a.saveMessagesToFile(messages, filename)
}

func (a *App) ExportAllMessages(connId uint) (string, error) {
	messages, filename, err := a.collectAllMessages(connId)
	if err != nil {
		return "", err
	}
	return a.saveMessagesToFile(messages, filename)
}

// ExportTopicMessagesData returns the same export as ExportTopicMessages but as
// a JSON string plus default filename, for the browser build to download.
func (a *App) ExportTopicMessagesData(connId uint, topic string) (ExportedMessagesPayload, error) {
	messages, filename, err := a.collectTopicMessages(connId, topic)
	if err != nil {
		return ExportedMessagesPayload{}, err
	}
	return marshalMessagesPayload(messages, filename)
}

// ExportAllMessagesData returns the same export as ExportAllMessages but as a
// JSON string plus default filename, for the browser build to download.
func (a *App) ExportAllMessagesData(connId uint) (ExportedMessagesPayload, error) {
	messages, filename, err := a.collectAllMessages(connId)
	if err != nil {
		return ExportedMessagesPayload{}, err
	}
	return marshalMessagesPayload(messages, filename)
}

func (a *App) collectTopicMessages(connId uint, topic string) ([]exportedMessage, string, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, "", fmt.Errorf("connection not found")
	}
	history, err := appConnection.MqttManager.MessageHistory.GetTopicHistory(topic)
	if err != nil {
		return nil, "", err
	}
	messages := toExportedMessages(history)
	filename := fmt.Sprintf("mqtt-messages-%s.json", strings.ReplaceAll(topic, "/", "-"))
	return messages, filename, nil
}

func (a *App) collectAllMessages(connId uint) ([]exportedMessage, string, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, "", fmt.Errorf("connection not found")
	}
	allHistory := appConnection.MqttManager.MessageHistory.GetAllHistory()
	messages := []exportedMessage{}
	for _, history := range allHistory {
		messages = append(messages, toExportedMessages(history)...)
	}
	sort.Slice(messages, func(i, j int) bool {
		return messages[i].TimeMs < messages[j].TimeMs
	})
	return messages, "mqtt-messages-all.json", nil
}

func marshalMessagesPayload(messages []exportedMessage, filename string) (ExportedMessagesPayload, error) {
	data, err := json.MarshalIndent(messages, "", "  ")
	if err != nil {
		return ExportedMessagesPayload{}, err
	}
	return ExportedMessagesPayload{
		Filename: filename,
		Json:     string(data),
	}, nil
}

func (a *App) saveMessagesToFile(messages []exportedMessage, defaultFilename string) (string, error) {
	path, err := application.Get().Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:    "Export message history",
		Filename: defaultFilename,
		Filters: []application.FileFilter{
			{
				DisplayName: "JSON Files (*.json)",
				Pattern:     "*.json",
			},
		},
	}).PromptForSingleSelection()
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
