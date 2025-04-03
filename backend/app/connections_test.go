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
