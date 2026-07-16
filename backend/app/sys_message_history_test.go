package app

import (
	"mqtt-viewer/backend/mqtt"
	"testing"
)

// These exercise the pure sort core of GetSysMessageHistory (the $SYS/ prefix
// filtering now lives in MessageHistory.GetHistoryByTopicPrefix, tested in the
// mqtt package) so they need no broker.

func sysMsg(topic string, timeMs int64) mqtt.MqttMessage {
	return mqtt.MqttMessage{Topic: topic, TimeMs: timeMs, Payload: []byte("1")}
}

func TestSortMessagesByTimeAscending(t *testing.T) {
	messages := []mqtt.MqttMessage{
		sysMsg("$SYS/broker/load/messages/received/1min", 300),
		sysMsg("$SYS/broker/uptime", 200),
		sysMsg("$SYS/broker/load/messages/received/1min", 100),
	}
	sortMessagesByTimeAsc(messages)
	if len(messages) != 3 {
		t.Fatalf("Expected 3 messages, got %v", len(messages))
	}
	for i := 1; i < len(messages); i++ {
		if messages[i].TimeMs < messages[i-1].TimeMs {
			t.Fatalf("Expected ascending timeMs, got %v after %v", messages[i].TimeMs, messages[i-1].TimeMs)
		}
	}
}

func TestSortMessagesByTimeEmpty(t *testing.T) {
	messages := []mqtt.MqttMessage{}
	sortMessagesByTimeAsc(messages)
	if len(messages) != 0 {
		t.Errorf("Expected empty result, got %v", len(messages))
	}
}

func TestGetSysMessageHistoryUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if _, err := app.GetSysMessageHistory(999); err == nil {
		t.Error("Expected error for unknown connection, got nil")
	}
}

func TestGetSysMessageHistoryEmptyForFreshConnection(t *testing.T) {
	app := getSeededTestApp(t)
	messages, err := app.GetSysMessageHistory(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(messages) != 0 {
		t.Errorf("Expected no messages for a fresh connection, got %v", len(messages))
	}
}
