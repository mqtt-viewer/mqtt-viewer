package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// firstConnId returns any connection id from the seeded app. The seeded
// connections have no in-memory message history, so the exports come back as an
// empty JSON array — enough to assert the payload shape and filename logic
// without needing a live broker.
func firstConnId(t *testing.T, app *App) uint {
	t.Helper()
	for id := range app.AppConnections {
		return id
	}
	t.Fatal("expected at least one seeded connection")
	return 0
}

func TestExportAllMessagesDataReturnsValidJsonAndFilename(t *testing.T) {
	app := getSeededTestApp(t)
	connId := firstConnId(t, app)

	payload, err := app.ExportAllMessagesData(connId)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if payload.Filename != "mqtt-messages-all.json" {
		t.Errorf("expected fixed all-messages filename, got %q", payload.Filename)
	}

	// An empty in-memory history marshals to an empty JSON array, which is what
	// the browser download receives. Both the JSON string and the two-space
	// indent behaviour are shared with the topic export via marshalMessagesPayload.
	if !strings.HasPrefix(payload.Json, "[") {
		t.Errorf("expected a JSON array, got %q", payload.Json)
	}
	var out []exportedMessage
	if err := json.Unmarshal([]byte(payload.Json), &out); err != nil {
		t.Errorf("expected valid JSON, got error %v for %q", err, payload.Json)
	}
}

func TestExportAllMessagesDataErrorsForUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.ExportAllMessagesData(999); err == nil {
		t.Error("expected an error for a connection that does not exist")
	}
}

func TestExportTopicMessagesDataErrorsForUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.ExportTopicMessagesData(999, "a/b"); err == nil {
		t.Error("expected an error for a connection that does not exist")
	}
}

// A topic with no history surfaces the same "topic not found" error as the
// desktop ExportTopicMessages method (it is collected the same way), rather than
// silently producing an empty file.
func TestExportTopicMessagesDataErrorsForTopicWithNoHistory(t *testing.T) {
	app := getSeededTestApp(t)
	connId := firstConnId(t, app)

	if _, err := app.ExportTopicMessagesData(connId, "sensors/temperature"); err == nil {
		t.Error("expected an error for a topic with no message history")
	}
}

func TestCheckForUpdatesWithNilUpdaterDoesNotPanic(t *testing.T) {
	// In test mode the updater is never initialised, mirroring server mode where
	// the self-updater is deliberately skipped. The bound method must return a
	// no-op result rather than dereferencing a nil Updater.
	app := getTestApp(t)
	if app.Updater != nil {
		t.Fatal("expected a nil Updater in test mode")
	}

	resp, err := app.CheckForUpdates()
	if err != nil {
		t.Errorf("expected no error, got %v", err)
	}
	if resp != nil {
		t.Errorf("expected a nil update response, got %v", resp)
	}

	if err := app.StartUpdate(); err != nil {
		t.Errorf("expected StartUpdate to be a no-op, got %v", err)
	}
}
