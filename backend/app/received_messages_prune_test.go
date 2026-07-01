package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"testing"
)

func enableRecording(t *testing.T, app *App) {
	t.Helper()
	if _, err := app.UpdateAppSettings(UpdateAppSettingsParams{
		MemoryBudgetBytes: 512 * 1024 * 1024,
		RecordingEnabled:  true,
		DiskBudgetBytes:   1024 * 1024 * 1024,
	}); err != nil {
		t.Fatalf("enabling recording: %v", err)
	}
}

func insertReceived(app *App, connID uint, n, payloadLen int) {
	payload := make([]byte, payloadLen)
	batch := make([]mqtt.MqttMessage, 0, n)
	for i := 0; i < n; i++ {
		batch = append(batch, mqtt.MqttMessage{
			Topic:   fmt.Sprintf("t/%d", i%32),
			Payload: payload,
		})
	}
	app.recordReceivedMessages(connID, batch)
}

func minMaxID(app *App) (int64, int64, int64) {
	var min, max, count int64
	app.Db.Model(&models.ReceivedMessage{}).Count(&count)
	if count == 0 {
		return 0, 0, 0
	}
	app.Db.Model(&models.ReceivedMessage{}).Select("MIN(id)").Scan(&min)
	app.Db.Model(&models.ReceivedMessage{}).Select("MAX(id)").Scan(&max)
	return min, max, count
}

func TestPruneBoundsSizeAndDropsOldest(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)

	insertReceived(app, conn.ConnectionDetails.ID, 20000, 256)

	usedBefore, err := app.usedBytes()
	if err != nil {
		t.Fatalf("usedBytes: %v", err)
	}
	minBefore, _, countBefore := minMaxID(app)
	if countBefore != 20000 {
		t.Fatalf("expected 20000 rows before prune, got %d", countBefore)
	}

	budget := usedBefore / 2
	app.pruneReceivedMessagesNow(budget)

	usedAfter, err := app.usedBytes()
	if err != nil {
		t.Fatalf("usedBytes after: %v", err)
	}
	minAfter, _, countAfter := minMaxID(app)

	if usedAfter >= usedBefore {
		t.Errorf("expected used to shrink, before=%d after=%d", usedBefore, usedAfter)
	}
	if usedAfter > budget*3/2 {
		t.Errorf("expected used (%d) within ~budget (%d)", usedAfter, budget)
	}
	if countAfter == 0 || countAfter >= countBefore {
		t.Errorf("expected some rows pruned, before=%d after=%d", countBefore, countAfter)
	}
	if minAfter <= minBefore {
		t.Errorf("expected oldest rows dropped (min id rose), before=%d after=%d", minBefore, minAfter)
	}
}

func TestPruneSkippedWhenBudgetZero(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)
	insertReceived(app, conn.ConnectionDetails.ID, 1000, 64)

	app.diskBudgetBytes.Store(0) // unlimited
	app.lastPruneCheckNanos.Store(0)
	app.pruneReceivedMessagesToBudget()

	var count int64
	app.Db.Model(&models.ReceivedMessage{}).Count(&count)
	if count != 1000 {
		t.Errorf("expected no pruning with zero budget, got %d rows", count)
	}
}

func TestClearReceivedMessages(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)
	insertReceived(app, conn.ConnectionDetails.ID, 500, 64)

	if err := app.ClearReceivedMessages(0); err != nil {
		t.Fatalf("clear: %v", err)
	}
	var count int64
	app.Db.Model(&models.ReceivedMessage{}).Count(&count)
	if count != 0 {
		t.Errorf("expected all cleared, got %d", count)
	}
}
