package app

import (
	"mqtt-viewer/backend/models"
	"testing"
)

const unknownConnId uint = 424242

func TestGetConnectionLogsUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if _, err := app.GetConnectionLogs(unknownConnId); err == nil {
		t.Error("expected error for unknown connection, got none")
	}
}

func TestClearConnectionLogsUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if err := app.ClearConnectionLogs(unknownConnId); err == nil {
		t.Error("expected error for unknown connection, got none")
	}
}

func TestSetConnectionDebugLoggingUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if err := app.SetConnectionDebugLogging(unknownConnId, true); err == nil {
		t.Error("expected error for unknown connection, got none")
	}
}

func TestSetLogsStreamingUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if err := app.SetLogsStreaming(unknownConnId, true); err == nil {
		t.Error("expected error for unknown connection, got none")
	}
}

func TestGetAndClearConnectionLogs(t *testing.T) {
	app := getTestApp(t)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Fatalf("NewConnection: %v", err)
	}
	connId := newConnection.ConnectionDetails.ID
	appConnection := app.AppConnections[connId]

	appConnection.MqttManager.LogStore.Info("first-line")
	appConnection.MqttManager.LogStore.Error("second-line")

	logs, err := app.GetConnectionLogs(connId)
	if err != nil {
		t.Fatalf("GetConnectionLogs: %v", err)
	}
	if len(logs) != 2 || logs[0].Message != "first-line" || logs[1].Message != "second-line" {
		t.Fatalf("expected the two logged lines, got %+v", logs)
	}

	if err := app.ClearConnectionLogs(connId); err != nil {
		t.Fatalf("ClearConnectionLogs: %v", err)
	}
	logs, err = app.GetConnectionLogs(connId)
	if err != nil {
		t.Fatalf("GetConnectionLogs after clear: %v", err)
	}
	if len(logs) != 0 {
		t.Errorf("expected no logs after clear, got %d", len(logs))
	}
}

func TestSetLogsStreamingKnownConnection(t *testing.T) {
	app := getTestApp(t)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Fatalf("NewConnection: %v", err)
	}
	connId := newConnection.ConnectionDetails.ID
	if err := app.SetLogsStreaming(connId, true); err != nil {
		t.Errorf("SetLogsStreaming on: %v", err)
	}
	if err := app.SetLogsStreaming(connId, false); err != nil {
		t.Errorf("SetLogsStreaming off: %v", err)
	}
}

func TestSetConnectionDebugLoggingPersistsAcrossReopen(t *testing.T) {
	app := getTestApp(t)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Fatalf("NewConnection: %v", err)
	}
	connId := newConnection.ConnectionDetails.ID

	if err := app.SetConnectionDebugLogging(connId, true); err != nil {
		t.Fatalf("SetConnectionDebugLogging: %v", err)
	}
	if !app.AppConnections[connId].MqttManager.LogStore.DebugEnabled() {
		t.Error("expected debug enabled on the live log store")
	}

	// Simulate an app restart: the persisted flag must survive and seed the
	// rebuilt connection's log store.
	app = reopenTestApp(t, app)

	conn := models.Connection{}
	if err := app.Db.First(&conn, connId).Error; err != nil {
		t.Fatalf("loading connection after reopen: %v", err)
	}
	if !conn.DebugLoggingEnabled {
		t.Error("expected debug_logging_enabled persisted as true")
	}
	if !app.AppConnections[connId].MqttManager.LogStore.DebugEnabled() {
		t.Error("expected reopened app to seed debug logging from the db")
	}

	// And flipping it off persists too.
	if err := app.SetConnectionDebugLogging(connId, false); err != nil {
		t.Fatalf("SetConnectionDebugLogging off: %v", err)
	}
	conn = models.Connection{}
	if err := app.Db.First(&conn, connId).Error; err != nil {
		t.Fatalf("reloading connection: %v", err)
	}
	if conn.DebugLoggingEnabled {
		t.Error("expected debug_logging_enabled persisted as false")
	}
}
