package app

import (
	"testing"
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
