package app

import (
	"mqtt-viewer/backend/mqtt"
	"testing"
)

// These exercise the pure flatten/filter/sort core of GetSysMessageHistory so
// they need no broker (the history store has no exported test seeding hook).

func sysMsg(topic string, timeMs int64) mqtt.MqttMessage {
	return mqtt.MqttMessage{Topic: topic, TimeMs: timeMs, Payload: []byte("1")}
}

func TestFlattenSysHistoryFiltersToSysTopics(t *testing.T) {
	all := map[string][]mqtt.MqttMessage{
		"$SYS/broker/uptime":            {sysMsg("$SYS/broker/uptime", 10)},
		"factory/line1/s1":              {sysMsg("factory/line1/s1", 20)},
		"$SYS/broker/clients/connected": {sysMsg("$SYS/broker/clients/connected", 30)},
		// "$SYS" alone (no slash) is not a status metric topic.
		"$SYS": {sysMsg("$SYS", 40)},
	}
	result := flattenSysHistory(all)
	if len(result) != 2 {
		t.Fatalf("Expected 2 $SYS/ messages, got %v", len(result))
	}
	for _, msg := range result {
		if msg.Topic != "$SYS/broker/uptime" && msg.Topic != "$SYS/broker/clients/connected" {
			t.Errorf("Unexpected topic in result: %v", msg.Topic)
		}
	}
}

func TestFlattenSysHistorySortsByTimeAscendingAcrossTopics(t *testing.T) {
	all := map[string][]mqtt.MqttMessage{
		"$SYS/broker/load/messages/received/1min": {
			sysMsg("$SYS/broker/load/messages/received/1min", 300),
			sysMsg("$SYS/broker/load/messages/received/1min", 100),
		},
		"$SYS/broker/uptime": {sysMsg("$SYS/broker/uptime", 200)},
	}
	result := flattenSysHistory(all)
	if len(result) != 3 {
		t.Fatalf("Expected 3 messages, got %v", len(result))
	}
	for i := 1; i < len(result); i++ {
		if result[i].TimeMs < result[i-1].TimeMs {
			t.Fatalf("Expected ascending timeMs, got %v after %v", result[i].TimeMs, result[i-1].TimeMs)
		}
	}
}

func TestFlattenSysHistoryEmpty(t *testing.T) {
	result := flattenSysHistory(map[string][]mqtt.MqttMessage{})
	if len(result) != 0 {
		t.Errorf("Expected empty result, got %v", len(result))
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
