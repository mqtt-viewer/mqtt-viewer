package app

import (
	"testing"
)

// These tests verify that MQTT methods return an error (rather than
// panicking on a nil map entry) when called with a connId that has no
// AppConnection. They do not require a broker.

const unknownConnId uint = 999

func TestConnectMqttUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	err := app.ConnectMqtt(unknownConnId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}

func TestDisconnectMqttUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	err := app.DisconnectMqtt(unknownConnId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}

func TestGetMessageHistoryUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	messages, err := app.GetMessageHistory(unknownConnId, "some/topic")
	if err == nil {
		t.Errorf("Expected error, got none")
	}
	if messages != nil {
		t.Errorf("Expected nil messages, got %v", messages)
	}
}

func TestClearConnectionHistoryUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	err := app.ClearConnectionHistory(unknownConnId)
	if err == nil {
		t.Errorf("Expected error, got none")
	}
}
