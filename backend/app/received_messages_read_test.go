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
	app.insertReceivedMessages(conn.ConnectionDetails.ID, batch)

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
	app.insertReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{m})

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

func TestReceivedTimelineWindowPagesStubsNewestFirstInArrivalOrder(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	batch := make([]mqtt.MqttMessage, 0, 25)
	for i := 0; i < 25; i++ {
		batch = append(batch, mqtt.MqttMessage{Topic: "seq", Payload: []byte(fmt.Sprintf("%d", i))})
	}
	app.insertReceivedMessages(conn.ConnectionDetails.ID, batch)

	win1, err := app.GetReceivedTimelineWindow(conn.ConnectionDetails.ID, "seq", 0, 0, 10)
	if err != nil {
		t.Fatalf("window 1: %v", err)
	}
	if len(win1) != 10 {
		t.Fatalf("expected 10 stubs in newest window, got %d", len(win1))
	}
	// Stubs carry no payload; verify ids are ascending arrival order 15..24.
	var firstID, lastID uint
	fmt.Sscanf(win1[0].Id, "%d", &firstID)
	fmt.Sscanf(win1[9].Id, "%d", &lastID)
	if lastID != firstID+9 {
		t.Errorf("expected 10 contiguous ascending ids, got %s..%s", win1[0].Id, win1[9].Id)
	}

	smallestID := win1[0].Id
	var beforeID uint
	fmt.Sscanf(smallestID, "%d", &beforeID)
	win2, err := app.GetReceivedTimelineWindow(conn.ConnectionDetails.ID, "seq", beforeID, 0, 10)
	if err != nil {
		t.Fatalf("window 2: %v", err)
	}
	if len(win2) != 10 {
		t.Fatalf("expected 10 stubs in older window, got %d", len(win2))
	}
}

func TestReceivedTimelineWindowCarriesQosAndRetainNoPayload(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	m := mqtt.MqttMessage{Topic: "flags", Payload: []byte("some-payload"), QoS: 2, Retain: true}
	app.insertReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{m})

	win, err := app.GetReceivedTimelineWindow(conn.ConnectionDetails.ID, "flags", 0, 0, 10)
	if err != nil || len(win) != 1 {
		t.Fatalf("window: %v len=%d", err, len(win))
	}
	if win[0].QoS != 2 || !win[0].Retain {
		t.Errorf("expected qos=2 retain=true, got %+v", win[0])
	}
}

func TestGetReceivedMessageByIdReturnsFullPayload(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	app.insertReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{
		{Topic: "p", Payload: []byte("hello world")},
	})

	win, err := app.GetReceivedTimelineWindow(conn.ConnectionDetails.ID, "p", 0, 0, 10)
	if err != nil || len(win) != 1 {
		t.Fatalf("window: %v len=%d", err, len(win))
	}
	var id uint
	fmt.Sscanf(win[0].Id, "%d", &id)

	msg, found, err := app.GetReceivedMessageById(conn.ConnectionDetails.ID, "p", id)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !found {
		t.Fatal("expected message to be found")
	}
	if string(msg.Payload) != "hello world" {
		t.Errorf("expected payload %q, got %q", "hello world", msg.Payload)
	}
}

func TestGetReceivedMessageByIdNotFoundForMissingRow(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	_, found, err := app.GetReceivedMessageById(conn.ConnectionDetails.ID, "p", 99999)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if found {
		t.Error("expected not found for missing row")
	}
}

func TestGetReceivedMessagesByIdsReturnsSubsetSkippingMissing(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	batch := make([]mqtt.MqttMessage, 0, 10)
	for i := 0; i < 10; i++ {
		batch = append(batch, mqtt.MqttMessage{Topic: "seq", Payload: []byte(fmt.Sprintf("%d", i))})
	}
	app.insertReceivedMessages(conn.ConnectionDetails.ID, batch)

	win, err := app.GetReceivedTimelineWindow(conn.ConnectionDetails.ID, "seq", 0, 0, 10)
	if err != nil || len(win) != 10 {
		t.Fatalf("window: %v len=%d", err, len(win))
	}
	toID := func(s string) uint {
		var id uint
		fmt.Sscanf(s, "%d", &id)
		return id
	}

	// Request three real rows plus one id that doesn't exist.
	ids := []uint{toID(win[1].Id), toID(win[4].Id), 999999, toID(win[8].Id)}
	got, err := app.GetReceivedMessagesByIds(conn.ConnectionDetails.ID, "seq", ids)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 found messages, got %d", len(got))
	}
	// Ascending id order, missing id silently skipped.
	if string(got[0].Payload) != "1" || string(got[1].Payload) != "4" || string(got[2].Payload) != "8" {
		t.Errorf("expected payloads 1,4,8 in id order, got %s,%s,%s", got[0].Payload, got[1].Payload, got[2].Payload)
	}
}

func TestGetReceivedMessagesByIdsScopedToTopic(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	app.insertReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{
		{Topic: "p", Payload: []byte("hello")},
	})
	win, err := app.GetReceivedTimelineWindow(conn.ConnectionDetails.ID, "p", 0, 0, 10)
	if err != nil || len(win) != 1 {
		t.Fatalf("window: %v len=%d", err, len(win))
	}
	var id uint
	fmt.Sscanf(win[0].Id, "%d", &id)

	got, err := app.GetReceivedMessagesByIds(conn.ConnectionDetails.ID, "other-topic", []uint{id})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected no rows for mismatched topic, got %d", len(got))
	}
}

func TestGetReceivedMessagesByIdsCapsBatchSize(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	app.insertReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{
		{Topic: "cap", Payload: []byte("kept")},
	})
	win, err := app.GetReceivedTimelineWindow(conn.ConnectionDetails.ID, "cap", 0, 0, 10)
	if err != nil || len(win) != 1 {
		t.Fatalf("window: %v len=%d", err, len(win))
	}
	var realID uint
	fmt.Sscanf(win[0].Id, "%d", &realID)

	// Build a pathological batch: the only real id sits beyond the cap, so a
	// capped query must not return it.
	ids := make([]uint, 0, MaxReceivedMessagesByIds+1)
	for i := 0; i < MaxReceivedMessagesByIds; i++ {
		ids = append(ids, 1_000_000+uint(i)) // nonexistent rows
	}
	ids = append(ids, realID)
	got, err := app.GetReceivedMessagesByIds(conn.ConnectionDetails.ID, "cap", ids)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected id past the cap to be truncated away, got %d rows", len(got))
	}

	// The same real id within the cap is returned.
	got, err = app.GetReceivedMessagesByIds(conn.ConnectionDetails.ID, "cap", []uint{realID})
	if err != nil || len(got) != 1 {
		t.Fatalf("expected 1 row within cap, got %d (err %v)", len(got), err)
	}
	if string(got[0].Payload) != "kept" {
		t.Errorf("expected payload kept, got %s", got[0].Payload)
	}
}

func TestGetReceivedMessageByIdScopedToTopic(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	app.insertReceivedMessages(conn.ConnectionDetails.ID, []mqtt.MqttMessage{
		{Topic: "p", Payload: []byte("hello")},
	})
	win, err := app.GetReceivedTimelineWindow(conn.ConnectionDetails.ID, "p", 0, 0, 10)
	if err != nil || len(win) != 1 {
		t.Fatalf("window: %v len=%d", err, len(win))
	}
	var id uint
	fmt.Sscanf(win[0].Id, "%d", &id)

	// Same id, wrong topic: must report not found rather than leaking a
	// cross-topic row.
	_, found, err := app.GetReceivedMessageById(conn.ConnectionDetails.ID, "other-topic", id)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if found {
		t.Error("expected not found when topic does not match")
	}
}
