package app

import (
	"mqtt-viewer/backend/models"
	"testing"
)

// TestUpdateConnectionOmitsProtoRegDir guards against UpdateConnection
// reverting an import: ImportProtoDir/ReimportProto/ClearProtoImport own
// Connection.ProtoRegDir now, so a connection-edit payload built from a
// frontend row fetched before an import last changed it (a stale pointer)
// must not overwrite the current value on save.
func TestUpdateConnectionOmitsProtoRegDir(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	stale := "/definitely/not/the/current/import/dir"
	var updated models.Connection
	if res := app.Db.First(&updated, connId); res.Error != nil {
		t.Fatalf("fetching connection: %v", res.Error)
	}
	updated.Name = "Renamed while holding a stale ProtoRegDir"
	updated.ProtoRegDir = &stale

	if err := app.UpdateConnection(&updated); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	var after models.Connection
	if res := app.Db.First(&after, connId); res.Error != nil {
		t.Fatalf("fetching connection: %v", res.Error)
	}
	if after.Name != "Renamed while holding a stale ProtoRegDir" {
		t.Errorf("Expected the name edit to persist, got %v", after.Name)
	}
	if after.ProtoRegDir == nil || *after.ProtoRegDir != testProtosGoodDir {
		t.Errorf("Expected ProtoRegDir to stay at the imported dir %v, got %v", testProtosGoodDir, after.ProtoRegDir)
	}
}

func TestNewConnectionsAreCreatedWhenNoneExist(t *testing.T) {
	app := getTestApp(t)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if len(app.AppConnections) != 1 {
		t.Errorf("Expected 1 connection, got %v", len(app.AppConnections))
	}
	if newConnection.IsConnected == true {
		t.Errorf("Expected connection to be disconnected, got connected")
	}
}

func TestNewConnectionsAreCreatedWhenSomeExist(t *testing.T) {
	app := getSeededTestApp(t)
	oldLen := len(app.AppConnections)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if len(app.AppConnections) != oldLen+1 {
		t.Errorf("Expected 6 connections, got %v", len(app.AppConnections))
	}
	if newConnection.IsConnected == true {
		t.Errorf("Expected connection to be disconnected, got connected")
	}
}

func TestNewConnectionsHaveCorrectEventSet(t *testing.T) {
	app := getSeededTestApp(t)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	wantedEventSet := app.Events.GetConnectionEventsSet(newConnection.ConnectionDetails.ID)
	if newConnection.EventSet.MqttConnected != wantedEventSet.MqttConnected {
		t.Errorf("Expected new connection to have correct event set, got incorrect")
	}
	if newConnection.EventSet.MqttDisconnected != wantedEventSet.MqttDisconnected {
		t.Errorf("Expected new connection to have correct event set, got incorrect")
	}
	if newConnection.EventSet.MqttMessages != wantedEventSet.MqttMessages {
		t.Errorf("Expected new connection to have correct event set, got incorrect")
	}
}

func TestNewConnectionHasCorrectSubs(t *testing.T) {
	app := getSeededTestApp(t)
	newConnection, _ := app.NewConnection()
	if len(newConnection.ConnectionDetails.Subscriptions) != 2 {
		t.Errorf("Expected 2 subscriptions, got %v", len(newConnection.ConnectionDetails.Subscriptions))
	}
	if newConnection.ConnectionDetails.Subscriptions[0].Topic != "#" {
		t.Errorf("Expected first subscription to be #, got %v", newConnection.ConnectionDetails.Subscriptions[0].Topic)
	}
	if newConnection.ConnectionDetails.Subscriptions[1].Topic != "$SYS/#" {
		t.Errorf("Expected second subscription to be $SYS/#, got %v", newConnection.ConnectionDetails.Subscriptions[1].Topic)
	}
}
