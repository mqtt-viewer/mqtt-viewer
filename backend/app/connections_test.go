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

func TestNewConnectionsHaveCorrectAppConnectionMapId(t *testing.T) {
	app := getSeededTestApp(t)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	seenConnectionIds := make(map[uint]bool)
	for id, conn := range app.AppConnections {
		seenConnectionIds[conn.Connection.ID] = true
		if uint(id) != conn.Connection.ID {
			t.Errorf("Expected app connection id %v, got %v", id, conn.Connection.ID)
		}
	}
	if !seenConnectionIds[newConnection.ConnectionDetails.ID] {
		t.Errorf("Expected new connection id to be in app connection map")
	}
}

func TestUpdateConnection(t *testing.T) {
	app := getSeededTestApp(t)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	newName := "Super Fresh New Connection Name"
	newConnection.ConnectionDetails.Name = newName
	newConn, err := app.UpdateConnection(&newConnection.ConnectionDetails)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if newConn.ConnectionDetails.Name != "Super Fresh New Connection Name" {
		t.Errorf("Expected connection name to be updated to %v, got %v", newName, newConn.ConnectionDetails.Name)
	}
	savedAppConn := app.AppConnections[newConn.ConnectionDetails.ID]
	if savedAppConn.Connection.Name != "Super Fresh New Connection Name" {
		t.Errorf("Expected stored app connection name to be updated to %v, got %v", newName, savedAppConn.Connection.Name)
	}
}

func TestUpdateConnectionPreservesReferences(t *testing.T) {
	app := getSeededTestApp(t)
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	prevConnectionDetails := app.AppConnections[newConnection.ConnectionDetails.ID].Connection
	newName := "Super Fresh New Connection Name"
	newConnection.ConnectionDetails.Name = newName

	_, err = app.UpdateConnection(&newConnection.ConnectionDetails)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if newConnection.ConnectionDetails.Name != "Super Fresh New Connection Name" {
		t.Errorf("Expected connection name to be updated to %v, got %v", newName, newConnection.ConnectionDetails.Name)
	}
	if app.AppConnections[newConnection.ConnectionDetails.ID].Connection != prevConnectionDetails {
		t.Errorf("Expected app connection to be the same after saving, got different")
	}

}

func TestUpdateConnectionUpdatesHasCustomClientId(t *testing.T) {
	app := getSeededTestApp(t)
	var trueVal = true
	var falseVal = false
	newConnection, err := app.NewConnection()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	newConnection.ConnectionDetails.HasCustomClientId = &trueVal
	_, err = app.UpdateConnection(&newConnection.ConnectionDetails)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	savedAppConn := app.AppConnections[newConnection.ConnectionDetails.ID]
	if *savedAppConn.Connection.HasCustomClientId != true {
		t.Errorf("Expected HasCustomClientId to be true, got %v", savedAppConn.Connection.HasCustomClientId)
	}

	newConnection.ConnectionDetails.HasCustomClientId = &falseVal
	t.Logf("newConnection.ConnectionDetails: %+v", newConnection.ConnectionDetails)
	_, err = app.UpdateConnection(&newConnection.ConnectionDetails)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	savedAppConn = app.AppConnections[newConnection.ConnectionDetails.ID]
	if *savedAppConn.Connection.HasCustomClientId != false {
		t.Errorf("Expected HasCustomClientId to be false, got %v", savedAppConn.Connection.HasCustomClientId)
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

func TestCreatingMultipleNewConnections(t *testing.T) {
	app := getSeededTestApp(t)
	newConnIds := []uint{}
	for i := 0; i < 10; i++ {
		newConn, err := app.NewConnection()
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
		newConnIds = append(newConnIds, newConn.ConnectionDetails.ID)
		if len(app.AppConnections) != 6+i {
			t.Errorf("Expected %v connections, got %v", 6+i, len(app.AppConnections))
		}
	}
	seenSubIds := make(map[uint]bool)
	for _, connId := range newConnIds {
		conn := app.AppConnections[uint(connId)]
		if len(conn.Connection.Subscriptions) != 2 {
			t.Errorf("Expected 2 subscriptions, got %v", len(conn.Connection.Subscriptions))
		}
		if conn.Connection.Subscriptions[0].Topic != "#" {
			t.Errorf("Expected first subscription to be #, got %v", conn.Connection.Subscriptions[0].Topic)
		}
		if conn.Connection.Subscriptions[1].Topic != "$SYS/#" {
			t.Errorf("Expected second subscription to be $SYS/#, got %v", conn.Connection.Subscriptions[1].Topic)
		}
		if _, ok := seenSubIds[conn.Connection.Subscriptions[0].ID]; ok {
			t.Errorf("Expected new connection to have unique subscription ids")
		}
		if _, ok := seenSubIds[conn.Connection.Subscriptions[1].ID]; ok {
			t.Errorf("Expected new connection to have unique subscription ids")
		}
		seenSubIds[conn.Connection.Subscriptions[0].ID] = true
		seenSubIds[conn.Connection.Subscriptions[1].ID] = true
	}
}
