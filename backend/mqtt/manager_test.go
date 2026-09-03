package mqtt

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestConnectV3(t *testing.T) {
	testConnect(t, "3")
}

func TestConnectV5(t *testing.T) {
	testConnect(t, "5")
}

func testConnect(t *testing.T, mqttVersion string) {
	m := getTestMqttManager(t)
	topic := testTopic(t)
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
			Topic: topic,
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
	topic := testTopic(t)
	connDetails := MqttConnectionDetails{
		Host:        "localhost",
		Port:        9001,
		Protocol:    "ws",
		MqttVersion: mqttVersion,
	}
	err := m.Connect(connDetails, []SubscribeParams{
		{
			Topic: topic,
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
	topic := testTopic(t)
	connDetails := MqttConnectionDetails{
		Host:        "localhost",
		Port:        1883,
		Protocol:    "mqtt",
		MqttVersion: mqttVersion,
	}
	err := m.Connect(connDetails, []SubscribeParams{
		{
			Topic: topic,
			QoS:   0,
		},
	})
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	publishParams := MqttPublishParams{
		Topic:   topic,
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
	history, err := m.MessageHistory.GetTopicHistory(topic)
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

// testTopic gives each run its own topic. The test broker is shared across
// worktrees, so a topic fixed to t.Name() means a concurrent run's messages
// arrive here too, which shows up as "Expected 1 message in history, got 2".
func testTopic(t *testing.T) string {
	t.Helper()
	return fmt.Sprintf("%s/%d/%s", t.Name(), os.Getpid(), uuid.NewString())
}

func TestV3MultiSubscribe(t *testing.T) {
	testMultiSubscribe(t, "3")
}

func TestV5MultiSubscribe(t *testing.T) {
	testMultiSubscribe(t, "5")
}

// testMultiSubscribe connects with several subscriptions, one of them a
// wildcard, and checks every published message lands in history exactly once.
// The filters are deliberately non-overlapping: a message matching more than
// one filter may be delivered once per matching subscription, which is broker
// dependent and would make the count assertion flaky.
func testMultiSubscribe(t *testing.T, mqttVersion string) {
	m := getTestMqttManager(t)
	connDetails := MqttConnectionDetails{
		Host:        "localhost",
		Port:        1883,
		Protocol:    "mqtt",
		MqttVersion: mqttVersion,
	}

	first := fmt.Sprintf("%v/first", t.Name())
	second := fmt.Sprintf("%v/second", t.Name())
	wildcard := fmt.Sprintf("%v/wild/+", t.Name())
	wildcardMatch := fmt.Sprintf("%v/wild/leaf", t.Name())

	err := m.Connect(connDetails, []SubscribeParams{
		{Topic: first, QoS: 0},
		{Topic: second, QoS: 0},
		{Topic: wildcard, QoS: 0},
	})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	for _, topic := range []string{first, second, wildcardMatch} {
		err = m.Publish(MqttPublishParams{
			Topic:   topic,
			Payload: []byte("test"),
			QoS:     0,
			Retain:  false,
		})
		if err != nil {
			t.Fatalf("Expected no error publishing to %v, got %v", topic, err)
		}
	}
	// Give time to publish
	time.Sleep(500 * time.Millisecond)

	for _, topic := range []string{first, second, wildcardMatch} {
		history, err := m.MessageHistory.GetTopicHistory(topic)
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
			continue
		}
		if len(history) != 1 {
			t.Errorf("Expected 1 message in history for %v, got %v", topic, len(history))
		}
	}
}

func TestV3SubscribeSkipsEmptyTopics(t *testing.T) {
	testSubscribeSkipsEmptyTopics(t, "3")
}

func TestV5SubscribeSkipsEmptyTopics(t *testing.T) {
	testSubscribeSkipsEmptyTopics(t, "5")
}

// testSubscribeSkipsEmptyTopics covers an empty topic sitting in front of a
// real one. validateSubs only requires that one topic is non-empty, so this
// shape reaches the subscribe path and must not panic or lose the real
// subscription.
func testSubscribeSkipsEmptyTopics(t *testing.T, mqttVersion string) {
	m := getTestMqttManager(t)
	connDetails := MqttConnectionDetails{
		Host:        "localhost",
		Port:        1883,
		Protocol:    "mqtt",
		MqttVersion: mqttVersion,
	}
	err := m.Connect(connDetails, []SubscribeParams{
		{Topic: "", QoS: 0},
		{Topic: t.Name(), QoS: 0},
	})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	err = m.Publish(MqttPublishParams{
		Topic:   t.Name(),
		Payload: []byte("test"),
		QoS:     0,
		Retain:  false,
	})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	// Give time to publish
	time.Sleep(500 * time.Millisecond)

	history, err := m.MessageHistory.GetTopicHistory(t.Name())
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(history) != 1 {
		t.Errorf("Expected 1 message in history, got %v", len(history))
	}
}

func TestConnectV3RefusedPortFailsFast(t *testing.T) {
	testConnectRefusedPortFailsFast(t, "3")
}

func TestConnectV5RefusedPortFailsFast(t *testing.T) {
	testConnectRefusedPortFailsFast(t, "5")
}

// testConnectRefusedPortFailsFast connects to a port nothing is listening on.
// connectV3 used to ignore the connect token's result entirely and always
// wait out the full CONNECTION_TIMEOUT, returning the generic "timeout while
// connecting to broker" message instead of the real connection-refused error
// paho.mqtt.golang already had available. This pins the fast, real-error
// behaviour for both client versions.
func testConnectRefusedPortFailsFast(t *testing.T, mqttVersion string) {
	m := getTestMqttManager(t)
	topic := testTopic(t)

	// Bind then immediately release a port so nothing answers on it.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to reserve a port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	connDetails := MqttConnectionDetails{
		Host:        "127.0.0.1",
		Port:        port,
		Protocol:    "mqtt",
		MqttVersion: mqttVersion,
	}

	start := time.Now()
	err = m.Connect(connDetails, []SubscribeParams{{Topic: topic, QoS: 0}})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected an error connecting to a refused port")
	}
	if elapsed >= CONNECTION_TIMEOUT {
		t.Errorf("expected the connection-refused error to return well under the %v timeout, took %v: %v", CONNECTION_TIMEOUT, elapsed, err)
	}
	if strings.Contains(err.Error(), "timeout while connecting to broker") {
		t.Errorf("expected the real connection-refused error, got the generic timeout message: %v", err)
	}
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
		if m.GetConnectionState() != ConnectionStates.Disconnected {
			m.Disconnect(nil)
		}
	})
	return m
}
