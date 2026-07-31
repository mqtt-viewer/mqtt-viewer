package app

import (
	"mqtt-viewer/backend/models"
	"testing"
	"time"
)

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

// Locks in that a connection row with NULL optional columns is tolerated on
// startup rather than being silently dropped from the connection list.
func TestConnectionsWithNullColumnsLoadOnStartup(t *testing.T) {
	app := getTestApp(t)
	res := app.Db.Exec("INSERT INTO connections (name, mqtt_version, protocol, host, port, websocket_path) VALUES ('Raw insert', '5', 'mqtt', 'localhost', 1883, '')")
	if res.Error != nil {
		t.Fatalf("Expected no error inserting raw connection, got %v", res.Error)
	}

	app2 := reopenTestApp(t, app)
	conns := app2.GetAllConnections()
	if len(conns.Connections) != 1 {
		t.Fatalf("Expected 1 connection, got %v", len(conns.Connections))
	}
	for _, conn := range conns.Connections {
		if conn.ConnectionDetails.Name != "Raw insert" {
			t.Errorf("Expected connection name to be Raw insert, got %v", conn.ConnectionDetails.Name)
		}
		if conn.ConnectionDetails.LastConnectedAt != nil {
			t.Errorf("Expected LastConnectedAt to be nil, got %v", conn.ConnectionDetails.LastConnectedAt)
		}
		if conn.ConnectionDetails.CustomIconSeed != nil {
			t.Errorf("Expected CustomIconSeed to be nil, got %v", *conn.ConnectionDetails.CustomIconSeed)
		}
	}
}

// Same as above but with every non-id column left NULL.
func TestConnectionsWithAllNullColumnsLoadOnStartup(t *testing.T) {
	app := getTestApp(t)
	res := app.Db.Exec("INSERT INTO connections (id) VALUES (99)")
	if res.Error != nil {
		t.Fatalf("Expected no error inserting raw connection, got %v", res.Error)
	}

	app2 := reopenTestApp(t, app)
	conns := app2.GetAllConnections()
	if len(conns.Connections) != 1 {
		t.Fatalf("Expected 1 connection, got %v", len(conns.Connections))
	}
	conn, ok := conns.Connections[99]
	if !ok {
		t.Fatalf("Expected connection with id 99, got %v", conns.Connections)
	}
	if conn.ConnectionDetails.ID != 99 {
		t.Errorf("Expected connection id 99, got %v", conn.ConnectionDetails.ID)
	}
	if conn.ConnectionDetails.LastConnectedAt != nil {
		t.Errorf("Expected LastConnectedAt to be nil, got %v", conn.ConnectionDetails.LastConnectedAt)
	}
	if conn.ConnectionDetails.CustomIconSeed != nil {
		t.Errorf("Expected CustomIconSeed to be nil, got %v", *conn.ConnectionDetails.CustomIconSeed)
	}
}

// Documents the intended behaviour: GetAllConnections is driven by the
// in-memory AppConnections map built at startup, so rows written straight to
// the database are not picked up until the app restarts.
func TestGetAllConnectionsIgnoresRowsInsertedWithoutRestart(t *testing.T) {
	app := getTestApp(t)
	res := app.Db.Exec("INSERT INTO connections (name, mqtt_version, protocol, host, port, websocket_path) VALUES ('Raw insert', '5', 'mqtt', 'localhost', 1883, '')")
	if res.Error != nil {
		t.Fatalf("Expected no error inserting raw connection, got %v", res.Error)
	}

	conns := app.GetAllConnections()
	if len(conns.Connections) != 0 {
		t.Errorf("Expected 0 connections without a restart, got %v", len(conns.Connections))
	}
}

func TestDeleteConnectionRemovesAllConnectionScopedRows(t *testing.T) {
	app, firstID := getTestAppWithConnection(t)
	second, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating second connection: %v", err)
	}
	secondID := second.ConnectionDetails.ID

	// Seed every connection-scoped table for both connections so the delete
	// can be checked for scoping as well as completeness.
	for _, connID := range []uint{firstID, secondID} {
		if _, err := app.SavePublishHistoryEntry(SavePublishHistoryEntryParams{
			ConnectionId: connID,
			Topic:        "test/topic",
			Payload:      "hello",
		}); err != nil {
			t.Fatalf("seeding publish history for connection %d: %v", connID, err)
		}
		if _, err := app.SaveFilterHistoryEntry(connID, "some filter"); err != nil {
			t.Fatalf("seeding filter history for connection %d: %v", connID, err)
		}
		if res := app.Db.Create(&models.ReceivedMessage{ConnectionID: connID, Topic: "t", ReceivedAt: time.Now()}); res.Error != nil {
			t.Fatalf("seeding received message for connection %d: %v", connID, res.Error)
		}
		if _, err := app.AddSysMetricMapping(connID, models.SysMetricMapping{Label: "custom tile"}); err != nil {
			t.Fatalf("seeding sys metric mapping for connection %d: %v", connID, err)
		}
		collection, err := app.CreateCollection(CreateCollectionParams{Name: "Scoped", ConnectionID: uintPtr(connID)})
		if err != nil {
			t.Fatalf("seeding collection for connection %d: %v", connID, err)
		}
		if _, err := app.SaveCollectionMessage(SaveCollectionMessageParams{
			CollectionID: collection.ID,
			Name:         "msg",
			Topic:        "t",
		}); err != nil {
			t.Fatalf("seeding collection message for connection %d: %v", connID, err)
		}
	}

	// The regression: this used to fail with "FOREIGN KEY constraint failed"
	// because filter and publish history rows were left behind.
	if err := app.DeleteConnection(firstID); err != nil {
		t.Fatalf("DeleteConnection failed: %v", err)
	}

	type scopedCount struct {
		name  string
		model interface{}
	}
	scoped := []scopedCount{
		{"subscriptions", &models.Subscription{}},
		{"tabs", &models.Tab{}},
		{"filter histories", &models.FilterHistory{}},
		{"publish histories", &models.PublishHistory{}},
		{"received messages", &models.ReceivedMessage{}},
		{"sys metric mappings", &models.SysMetricMapping{}},
		{"collections", &models.Collection{}},
	}
	for _, s := range scoped {
		var n int64
		if err := app.Db.Model(s.model).Where("connection_id = ?", firstID).Count(&n).Error; err != nil {
			t.Fatalf("counting %s for deleted connection: %v", s.name, err)
		}
		if n != 0 {
			t.Errorf("expected 0 %s for deleted connection, got %d", s.name, n)
		}
	}
	var connCount int64
	if err := app.Db.Model(&models.Connection{}).Where("id = ?", firstID).Count(&connCount).Error; err != nil {
		t.Fatalf("counting deleted connection row: %v", err)
	}
	if connCount != 0 {
		t.Errorf("expected connection row deleted, got %d", connCount)
	}

	// The second connection's rows must all survive.
	for _, s := range scoped {
		if s.name == "subscriptions" {
			continue // NewConnection seeds two subscriptions; checked below
		}
		var n int64
		if err := app.Db.Model(s.model).Where("connection_id = ?", secondID).Count(&n).Error; err != nil {
			t.Fatalf("counting %s for surviving connection: %v", s.name, err)
		}
		if n != 1 {
			t.Errorf("expected 1 %s row for surviving connection, got %d", s.name, n)
		}
	}
	var survivingSubs int64
	if err := app.Db.Model(&models.Subscription{}).Where("connection_id = ?", secondID).Count(&survivingSubs).Error; err != nil {
		t.Fatalf("counting subscriptions for surviving connection: %v", err)
	}
	if survivingSubs != 2 {
		t.Errorf("expected 2 subscription rows for surviving connection, got %d", survivingSubs)
	}
	var survivingConn int64
	if err := app.Db.Model(&models.Connection{}).Where("id = ?", secondID).Count(&survivingConn).Error; err != nil {
		t.Fatalf("counting surviving connection row: %v", err)
	}
	if survivingConn != 1 {
		t.Errorf("expected surviving connection row to exist, got %d", survivingConn)
	}

	if _, ok := app.AppConnections[firstID]; ok {
		t.Errorf("expected deleted connection removed from AppConnections")
	}
}
