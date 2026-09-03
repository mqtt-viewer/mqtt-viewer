package mqtt

import (
	"fmt"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Needs the local test broker (scripts/test-broker.sh up).
//
// Publishes a numbered run to one topic and checks the history comes back in
// the order it was sent. This covers the whole receive path, including how the
// paho client dispatches to us, which the unit tests in receive_test.go cannot
// see.
//
// The broker is shared across worktrees, so both the topic and the client ID
// are made unique per run. A shared topic makes a second run's messages show up
// interleaved in this one, which fails with the exact "out of order" message
// this test uses to report the real bug, and getUniqueClientId only has
// second resolution, so two runs starting together evict each other's session.

func TestV3PreservesPublishOrder(t *testing.T) { testPreservesPublishOrder(t, "3") }
func TestV5PreservesPublishOrder(t *testing.T) { testPreservesPublishOrder(t, "5") }

func testPreservesPublishOrder(t *testing.T, mqttVersion string) {
	m := getTestMqttManager(t)
	runID := uuid.NewString()
	topic := fmt.Sprintf("%s/%d/%s", t.Name(), os.Getpid(), runID)
	err := m.Connect(MqttConnectionDetails{
		Host:        "localhost",
		Port:        1883,
		Protocol:    "mqtt",
		MqttVersion: mqttVersion,
		ClientId:    "mqtt-viewer-test-" + runID,
	}, []SubscribeParams{{Topic: topic, QoS: 0}})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	const n = 500
	for i := 0; i < n; i++ {
		err := m.Publish(MqttPublishParams{
			Topic:   topic,
			Payload: []byte(strconv.Itoa(i)),
			QoS:     0,
		})
		if err != nil {
			t.Fatalf("publish %d: %v", i, err)
		}
	}

	history := waitForBrokerHistory(t, m, topic, n)
	for i, msg := range history {
		want := strconv.Itoa(i)
		if string(msg.Payload) != want {
			t.Fatalf("message %d out of order: payload %q, want %q", i, msg.Payload, want)
		}
	}
}

func waitForBrokerHistory(t *testing.T, m *MqttManager, topic string, n int) []MqttMessage {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	var history []MqttMessage
	for time.Now().Before(deadline) {
		var err error
		history, err = m.MessageHistory.GetTopicHistory(topic)
		if err == nil && len(history) >= n {
			return history
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d messages, got %d", n, len(history))
	return nil
}
