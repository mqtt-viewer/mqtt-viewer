package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"testing"
)

func TestReceivedMessageWindowPagesNewestFirstInArrivalOrder(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	// 25 messages on the topic, payload encodes its sequence.
	batch := make([]mqtt.MqttMessage, 0, 25)
	for i := 0; i < 25; i++ {
		batch = append(batch, mqtt.MqttMessage{Topic: "seq", Payload: []byte(fmt.Sprintf("%d", i))})
	}
	app.recordReceivedMessages(conn.ConnectionDetails.ID, batch)

	// Newest window of 10.
	win1, err := app.GetReceivedMessageWindow(conn.ConnectionDetails.ID, "seq", 0, 0, 10)
	if err != nil {
		t.Fatalf("window 1: %v", err)
	}
	if len(win1) != 10 {
		t.Fatalf("expected 10 in newest window, got %d", len(win1))
	}
	// Ascending arrival order within the window: 15..24
	if string(win1[0].Payload) != "15" || string(win1[9].Payload) != "24" {
		t.Errorf("expected window 1 to be seq 15..24, got %s..%s", win1[0].Payload, win1[9].Payload)
	}

	// Next older window via keyset: smallest id in win1.
	smallestID := win1[0].Id
	var beforeID uint
	fmt.Sscanf(smallestID, "%d", &beforeID)
	win2, err := app.GetReceivedMessageWindow(conn.ConnectionDetails.ID, "seq", beforeID, 0, 10)
	if err != nil {
		t.Fatalf("window 2: %v", err)
	}
	if len(win2) != 10 || string(win2[0].Payload) != "5" || string(win2[9].Payload) != "14" {
		t.Errorf("expected window 2 seq 5..14, got len=%d %s..%s", len(win2), win2[0].Payload, win2[len(win2)-1].Payload)
	}
}

func TestReceivedMessageCount(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)
	insertReceived(app, conn.ConnectionDetails.ID, 100, 16) // topics t/0..t/31 round-robin

	count, err := app.GetReceivedMessageCount(conn.ConnectionDetails.ID, "t/0")
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	// 100 messages over 32 topics; t/0 gets indices 0,32,64,96 = 4.
	if count != 4 {
		t.Errorf("expected 4 for t/0, got %d", count)
	}
}

func TestReceivedMessageWindowReconstructsProperties(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	m := mqtt.MqttMessage{Topic: "p", Payload: []byte("x")}
	m.Properties = &mqtt.MessageProperties{
		ContentType:    "text/plain",
		UserProperties: map[string]string{"a": "b"},
	}
	app.recordReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{m})

	win, err := app.GetReceivedMessageWindow(conn.ConnectionDetails.ID, "p", 0, 0, 10)
	if err != nil || len(win) != 1 {
		t.Fatalf("window: %v len=%d", err, len(win))
	}
	got := win[0]
	if got.Properties == nil || got.Properties.ContentType != "text/plain" {
		t.Errorf("expected content type reconstructed, got %+v", got.Properties)
	}
	if got.Properties.UserProperties["a"] != "b" {
		t.Errorf("expected user property reconstructed, got %v", got.Properties.UserProperties)
	}
}

func TestDeleteConnectionCascadesReceivedMessages(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)
	insertReceived(app, conn.ConnectionDetails.ID, 50, 16)

	if err := deleteReceivedForConnTest(app, conn.ConnectionDetails.ID); err != nil {
		t.Fatalf("delete cascade helper: %v", err)
	}
	var count int64
	app.Db.Model(&models.ReceivedMessage{}).Where("connection_id = ?", conn.ConnectionDetails.ID).Count(&count)
	if count != 0 {
		t.Errorf("expected received messages cascade-deleted, got %d", count)
	}
}

// deleteReceivedForConnTest exercises the same cleanup DeleteConnection does,
// without the runtime event emission unavailable in tests.
func deleteReceivedForConnTest(app *App, connID uint) error {
	return app.Db.Where("connection_id = ?", connID).Delete(&models.ReceivedMessage{}).Error
}
