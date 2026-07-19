package app

import (
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"testing"
	"time"
)

// pollUntil polls cond until it returns true or the deadline elapses,
// failing the test in the latter case. Used for asserting async
// recording-worker effects without a fixed sleep.
func pollUntil(t *testing.T, deadline time.Duration, cond func() bool) {
	t.Helper()
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", deadline)
	}
}

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

func TestInsertReceivedMessagesPersists(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}

	batch := []mqtt.MqttMessage{
		recvMsg("sensors/temp", `{"t":21}`),
		recvMsg("sensors/temp", `{"t":22}`),
		recvMsg("sensors/hum", `{"h":40}`),
	}
	app.insertReceivedMessages(conn.ConnectionDetails.ID, batch)

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

func TestInsertReceivedMessagesPersistsUserProperties(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}

	m := recvMsg("v5/topic", "payload")
	m.Properties = &mqtt.MessageProperties{
		ContentType:    "application/json",
		UserProperties: map[string]string{"src": "test"},
	}
	app.insertReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{m})

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

func TestEnqueueRecordBatchNoOpWhenDisabled(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	app.loadRetentionSettings() // recording off by default

	app.enqueueRecordBatch(conn.ConnectionDetails.ID, []mqtt.MqttMessage{
		recvMsg("a/b", "hello"),
	})
	if got := countReceived(app); got != 0 {
		t.Errorf("expected 0 rows when recording disabled, got %d", got)
	}
}

// TestEnqueueRecordBatchDrainsViaWorker checks the full async path: enabling
// recording, enqueuing a batch, and letting the recording worker (started by
// Startup via getTestApp) drain it to the DB.
func TestEnqueueRecordBatchDrainsViaWorker(t *testing.T) {
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
	app.enqueueRecordBatch(conn.ConnectionDetails.ID, batch)

	pollUntil(t, 2*time.Second, func() bool {
		return countReceived(app) == 3
	})
}

// TestEnqueueRecordBatchDropsWhenQueueFull checks the load-shedding path
// directly: with a full queue and nobody draining it, enqueueRecordBatch
// must return immediately rather than block, and count the drop.
func TestEnqueueRecordBatchDropsWhenQueueFull(t *testing.T) {
	app := &App{}
	app.recordingEnabled.Store(true)
	app.recordQueue = make(chan recordBatch, 1)
	app.recordQueue <- recordBatch{} // fill it; nothing is draining

	done := make(chan struct{})
	go func() {
		app.enqueueRecordBatch(1, []mqtt.MqttMessage{recvMsg("a/b", "x")})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("enqueueRecordBatch blocked on a full queue")
	}
	if got := app.recordDropped.Load(); got != 1 {
		t.Errorf("expected recordDropped == 1, got %d", got)
	}
}
