package mqtt

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestConnectV3(t *testing.T) {
	testConnect(t, "3")
}

func TestConnectV5(t *testing.T) {
	testConnect(t, "5")
}

func testConnect(t *testing.T, mqttVersion string) {
	m := getTestMqttManager(t)
	hasConnecting := false
	hasConnected := false
	connectionCallbacks := MqttConnectionCallbacks{
		OnConnecting: func() {
			hasConnecting = true
		},
		OnConnectionUp: func() {
			hasConnected = true
		},
	}
	m.SetConnectionCallbacks(connectionCallbacks)

	connDetails := MqttConnectionDetails{
		Host:        "localhost",
		Port:        1883,
		Protocol:    "mqtt",
		MqttVersion: mqttVersion,
	}
	err := m.Connect(connDetails, []SubscribeParams{
		{
			Topic: t.Name(),
			QoS:   0,
		},
	})
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if !hasConnecting {
		t.Errorf("Expected connecting callback to be called")
	}
	if !hasConnected {
		t.Errorf("Expected connected callback to be called")
	}
}

func TestV3ConnectWs(t *testing.T) {
	testConnectWithWs(t, "3")
}

func testConnectWithWs(t *testing.T, mqttVersion string) {
	m := getTestMqttManager(t)
	connDetails := MqttConnectionDetails{
		Host:        "localhost",
		Port:        9001,
		Protocol:    "ws",
		MqttVersion: mqttVersion,
	}
	err := m.Connect(connDetails, []SubscribeParams{
		{
			Topic: t.Name(),
			QoS:   0,
		},
	})
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func TestV3PubSub(t *testing.T) {
	testPubSub(t, "3")
}

func TestV5PubSub(t *testing.T) {
	testPubSub(t, "5")
}

func testPubSub(t *testing.T, mqttVersion string) {
	m := getTestMqttManager(t)
	connDetails := MqttConnectionDetails{
		Host:        "localhost",
		Port:        1883,
		Protocol:    "mqtt",
		MqttVersion: mqttVersion,
	}
	err := m.Connect(connDetails, []SubscribeParams{
		{
			Topic: t.Name(),
			QoS:   0,
		},
	})
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	publishParams := MqttPublishParams{
		Topic:   t.Name(),
		Payload: []byte("test"),
		QoS:     0,
		Retain:  false,
	}
	err = m.Publish(publishParams)
	// Give time to publish
	time.Sleep(500 * time.Millisecond)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	history, err := m.MessageHistory.GetTopicHistory(t.Name())
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if len(history) != 1 {
		t.Errorf("Expected 1 message in history, got %v", len(history))
	}
	m.MessageBuffer.useBufferContents(func(buffer []MqttMessage) {
		if len(buffer) != 1 {
			t.Errorf("Expected 1 message in buffer, got %v", len(buffer))
		}
	})
}

func getTestMqttManager(t *testing.T) *MqttManager {
	m := NewMqttManager(context.Background(), func(int32) {})
	m.SetConnectionCallbacks(MqttConnectionCallbacks{
		OnConnecting: func() {
			fmt.Println("Connecting")
		},
		OnConnectionUp: func() {
			fmt.Println("Connected")
		},
		OnConnectionDown: func(cause *error) {
			fmt.Println("Disconnected")
		},
		OnReconnecting: func(cause *error) {
			fmt.Println("Reconnecting")
		},
		OnConnectionError: func(cause *error) {
			fmt.Println("Connection error")
		},
	})
	t.Cleanup(func() {
		if m.ConnectionState != ConnectionStates.Disconnected {
			m.Disconnect(nil)
		}
	})
	return m
}
