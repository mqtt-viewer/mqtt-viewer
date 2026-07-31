package app

import (
	"mqtt-viewer/backend/mqtt"
	"testing"
	"time"
)

// Broker-free coverage of the Sparkplug App methods' guard paths. The happy
// paths (decode, alias resolution, rebirth encoding) are covered in the
// sparkplug and mqtt-middleware packages.

func TestGetSparkplugMessageHistoryUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if _, err := app.GetSparkplugMessageHistory(999); err == nil {
		t.Error("Expected error for unknown connection, got nil")
	}
}

func TestGetSparkplugMessageHistoryEmptyForFreshConnection(t *testing.T) {
	app := getSeededTestApp(t)
	messages, err := app.GetSparkplugMessageHistory(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(messages) != 0 {
		t.Errorf("Expected no messages for a fresh connection, got %v", len(messages))
	}
}

// historyMessage is a minimal retained message; only topic and arrival time
// matter to the Sparkplug history filter.
func historyMessage(topic string, timeMs int64) mqtt.MqttMessage {
	return mqtt.MqttMessage{
		Id:      topic,
		Topic:   topic,
		Payload: []byte("{}"),
		TimeMs:  timeMs,
		Time:    time.UnixMilli(timeMs),
	}
}

func TestGetSparkplugMessageHistoryKeepsBirthsAndLatestData(t *testing.T) {
	app := getSeededTestApp(t)
	history := app.AppConnections[1].MqttManager.MessageHistory

	history.AddMessage(historyMessage("spBv1.0/G/NBIRTH/N", 1000))
	history.AddMessage(historyMessage("spBv1.0/G/DBIRTH/N/D", 1100))
	history.AddMessage(historyMessage("spBv1.0/G/NDATA/N", 1200))
	history.AddMessage(historyMessage("spBv1.0/G/NDATA/N", 1300))
	history.AddMessage(historyMessage("spBv1.0/G/NDATA/N", 1400))
	history.AddMessage(historyMessage("STATE/scada-primary", 1500))

	messages, err := app.GetSparkplugMessageHistory(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(messages) != 4 {
		t.Fatalf("Expected 4 messages (2 births, latest NDATA, STATE), got %v: %v", len(messages), topicsOf(messages))
	}

	want := []struct {
		topic  string
		timeMs int64
	}{
		{"spBv1.0/G/NBIRTH/N", 1000},
		{"spBv1.0/G/DBIRTH/N/D", 1100},
		{"spBv1.0/G/NDATA/N", 1400},
		{"STATE/scada-primary", 1500},
	}
	for i, expected := range want {
		if messages[i].Topic != expected.topic || messages[i].TimeMs != expected.timeMs {
			t.Errorf("Expected %s at %d in position %d, got %s at %d",
				expected.topic, expected.timeMs, i, messages[i].Topic, messages[i].TimeMs)
		}
	}
}

func TestNarrowSparkplugHistoryCapsResult(t *testing.T) {
	messages := []mqtt.MqttMessage{}
	for i := 0; i < maxSparkplugHistoryMessages+50; i++ {
		// Distinct edge nodes so every birth is kept rather than collapsed.
		messages = append(messages, historyMessage(
			"spBv1.0/G/NBIRTH/N"+string(rune('a'+i%26))+string(rune('a'+i/26%26))+string(rune('a'+i/676)),
			int64(i),
		))
	}
	narrowed := narrowSparkplugHistory(messages)
	if len(narrowed) != maxSparkplugHistoryMessages {
		t.Fatalf("Expected result capped at %d, got %d", maxSparkplugHistoryMessages, len(narrowed))
	}
	// The cap keeps the newest.
	if narrowed[len(narrowed)-1].TimeMs != int64(maxSparkplugHistoryMessages+49) {
		t.Errorf("Expected the newest message retained, got %d", narrowed[len(narrowed)-1].TimeMs)
	}
}

func topicsOf(messages []mqtt.MqttMessage) []string {
	topics := []string{}
	for _, message := range messages {
		topics = append(topics, message.Topic)
	}
	return topics
}

func TestPublishSparkplugRebirthRequiresGroupAndNode(t *testing.T) {
	app := getSeededTestApp(t)
	if err := app.PublishSparkplugRebirth(1, "", "node"); err == nil {
		t.Error("Expected error for empty group, got nil")
	}
	if err := app.PublishSparkplugRebirth(1, "group", ""); err == nil {
		t.Error("Expected error for empty edge node, got nil")
	}
}

func TestPublishSparkplugRebirthUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if err := app.PublishSparkplugRebirth(999, "group", "node"); err == nil {
		t.Error("Expected error for unknown connection, got nil")
	}
}

func TestPublishSparkplugRebirthNotConnected(t *testing.T) {
	app := getSeededTestApp(t)
	if err := app.PublishSparkplugRebirth(1, "group", "node"); err == nil {
		t.Error("Expected error for disconnected connection, got nil")
	}
}
