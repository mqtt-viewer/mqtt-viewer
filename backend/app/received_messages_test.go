package app

import (
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"testing"
	"time"
)

func recvMsg(topic, payload string) mqtt.MqttMessage {
	return mqtt.MqttMessage{
		Topic:   topic,
		Payload: []byte(payload),
		QoS:     1,
		Retain:  true,
		Time:    time.Now(),
	}
}

func countReceived(app *App) int64 {
	var n int64
	app.Db.Model(&models.ReceivedMessage{}).Count(&n)
	return n
}

func TestRecordReceivedMessagesNoOpWhenDisabled(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	app.loadRetentionSettings() // recording off by default

	app.recordReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{
		recvMsg("a/b", "hello"),
	})
	if got := countReceived(app); got != 0 {
		t.Errorf("expected 0 rows when recording disabled, got %d", got)
	}
}

func TestRecordReceivedMessagesPersistsWhenEnabled(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	if _, err := app.UpdateAppSettings(UpdateAppSettingsParams{
		MemoryBudgetBytes: 512 * 1024 * 1024,
		RecordingEnabled:  true,
		DiskBudgetBytes:   1024 * 1024 * 1024,
	}); err != nil {
		t.Fatalf("enabling recording: %v", err)
	}

	batch := []mqtt.MqttMessage{
		recvMsg("sensors/temp", `{"t":21}`),
		recvMsg("sensors/temp", `{"t":22}`),
		recvMsg("sensors/hum", `{"h":40}`),
	}
	app.recordReceivedMessages(conn.ConnectionDetails.ID, batch)

	if got := countReceived(app); got != 3 {
		t.Fatalf("expected 3 persisted rows, got %d", got)
	}

	var first models.ReceivedMessage
	if err := app.Db.Where("topic = ?", "sensors/temp").Order("id asc").First(&first).Error; err != nil {
		t.Fatalf("reading persisted row: %v", err)
	}
	if string(first.Payload) != `{"t":21}` {
		t.Errorf("expected payload roundtrip, got %q", string(first.Payload))
	}
	if first.ConnectionID != conn.ConnectionDetails.ID || first.QoS != 1 || !first.Retain {
		t.Errorf("unexpected persisted fields: %+v", first)
	}
}

func TestRecordReceivedMessagesPersistsUserProperties(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	if _, err := app.UpdateAppSettings(UpdateAppSettingsParams{
		MemoryBudgetBytes: 512 * 1024 * 1024,
		RecordingEnabled:  true,
		DiskBudgetBytes:   1024 * 1024 * 1024,
	}); err != nil {
		t.Fatalf("enabling recording: %v", err)
	}

	m := recvMsg("v5/topic", "payload")
	m.Properties = &mqtt.MessageProperties{
		ContentType:    "application/json",
		UserProperties: map[string]string{"src": "test"},
	}
	app.recordReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{m})

	var row models.ReceivedMessage
	if err := app.Db.First(&row).Error; err != nil {
		t.Fatalf("reading row: %v", err)
	}
	if row.HeaderContentType == nil || *row.HeaderContentType != "application/json" {
		t.Errorf("expected content type persisted, got %v", row.HeaderContentType)
	}
	if row.UserProperties == nil || *row.UserProperties != `{"src":"test"}` {
		t.Errorf("expected user properties JSON, got %v", row.UserProperties)
	}
}
