package app

import (
	"context"
	"fmt"
	"mqtt-viewer/backend/models"
	"strings"
	"testing"
	"time"
)

// The retained index itself is covered in backend/mqtt (history_test.go), which
// can exercise it without a broker. These cover the app layer's own contract:
// how it reports partial failure, how it refuses broker-reserved and
// oversized requests, and how it handles a connection that isn't there.

func TestDeleteRetainedMessagesReportsWhatItCleared(t *testing.T) {
	app := getTestApp(t)

	// No connection with this id, so every publish fails. The point is that it
	// attempts all of them and reports counts, rather than aborting on the
	// first: a half-cleared branch that reports nothing is worse than a full
	// attempt that says what broke. Partial/total publish failure is reported
	// in the result, not the error: the caller can still tell counts apart
	// from an outright refusal.
	result, err := app.DeleteRetainedMessages(999, []string{"a/one", "a/two", "a/three"})
	if err != nil {
		t.Fatalf("expected no error, publish failures are reported in the result: %v", err)
	}
	if result.Cleared != 0 {
		t.Errorf("expected 0 cleared, got %d", result.Cleared)
	}
	if result.Failed != 3 {
		t.Errorf("expected 3 failed, got %d", result.Failed)
	}
	if result.FirstError == "" {
		t.Error("expected FirstError to name a failure")
	}
}

func TestDeleteRetainedMessagesWithNoTopicsIsANoop(t *testing.T) {
	app := getTestApp(t)

	// The caller filters the prefix itself out of the list, so an empty list is
	// reachable and must not be treated as a failure.
	if result, err := app.DeleteRetainedMessages(999, nil); err != nil || result.Cleared != 0 || result.Failed != 0 {
		t.Errorf("clearing nothing should succeed with a zero result, got %+v, err %v", result, err)
	}
	if result, err := app.DeleteRetainedMessages(999, []string{}); err != nil || result.Cleared != 0 || result.Failed != 0 {
		t.Errorf("clearing an empty list should succeed with a zero result, got %+v, err %v", result, err)
	}
}

func TestGetRetainedTopicsUnderPrefixErrorsForUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.GetRetainedTopicsUnderPrefix(999, "a/b"); err == nil {
		t.Error("expected an error for a connection that does not exist")
	}
}

func TestDeleteRetainedMessageRefusesBrokerReservedTopic(t *testing.T) {
	app := getTestApp(t)

	// Connection 999 doesn't exist, so if the refusal didn't happen before the
	// publish path, this would fail with a "connection not found" error
	// instead. Asserting on the error text (not just non-nil) proves the
	// broker-reserved check runs first.
	err := app.DeleteRetainedMessage(999, "$SYS/broker/uptime")
	if err == nil {
		t.Fatal("expected an error clearing a $SYS topic")
	}
	if !strings.Contains(err.Error(), "belong to the broker") {
		t.Errorf("expected error to mention the broker, got: %v", err)
	}
}

func TestDeleteRetainedMessagesRefusesListContainingBrokerReservedTopic(t *testing.T) {
	app := getTestApp(t)

	result, err := app.DeleteRetainedMessages(999, []string{"a/one", "$SYS/broker/uptime", "a/two"})
	if err == nil {
		t.Fatal("expected an error when the list contains a $SYS topic")
	}
	if !strings.Contains(err.Error(), "belong to the broker") {
		t.Errorf("expected error to mention the broker, got: %v", err)
	}
	if result.Cleared != 0 || result.Failed != 0 {
		t.Errorf("expected the whole call refused before anything was attempted, got %+v", result)
	}
}

func TestDeleteRetainedMessagesRefusesOverTheLimit(t *testing.T) {
	app := getTestApp(t)

	topics := make([]string, MaxBulkRetainedClear+1)
	for i := range topics {
		topics[i] = fmt.Sprintf("a/%d", i)
	}

	_, err := app.DeleteRetainedMessages(999, topics)
	if err == nil {
		t.Fatal("expected an error when the list exceeds MaxBulkRetainedClear")
	}
	if !strings.Contains(err.Error(), "limit") {
		t.Errorf("expected error to mention the limit, got: %v", err)
	}
}

// TestDeleteRetainedMessageUnmarksIndexUnderV3 is the point of this suite: MQTT
// 3 never echoes a retained clear back to us (no RetainAsPublished), so the
// retained index must be unmarked by the clear itself, not by a broker echo.
//
// The retained message is published from a separate connection, before the
// connection under test subscribes. [MQTT-3.3.1-9] means a broker only sets
// the RETAIN flag on delivery when the message arrives via a newly
// established subscription; publishing on the connection under test (whose
// default "#" subscription is already active by the time ConnectMqtt
// returns) would deliver it live with RETAIN cleared, so the index would
// never get marked in the first place.
func TestDeleteRetainedMessageUnmarksIndexUnderV3(t *testing.T) {
	app := getTestApp(t)
	topic := "gotest121/" + t.Name()

	zeroQoS := uint(0)
	publisherConn := getNewConnectionWithCustomProperties(app, &models.Connection{
		MqttVersion:   "3",
		Subscriptions: []models.Subscription{{Topic: "gotest121/_unused", QoS: &zeroQoS}},
	})
	if err := app.ConnectMqtt(publisherConn.ConnectionId); err != nil {
		t.Fatalf("expected no error connecting publisher, got %v", err)
	}
	defer app.DisconnectMqtt(publisherConn.ConnectionId)
	// Always clean up any retained message left on the broker, even if the
	// test fails partway through.
	defer func() {
		_ = app.PublishMqtt(publisherConn.ConnectionId, PublishParams{
			Topic:   topic,
			QoS:     1,
			Payload: "",
			Retain:  true,
		})
	}()

	err := app.PublishMqtt(publisherConn.ConnectionId, PublishParams{
		Topic:   topic,
		QoS:     1,
		Payload: "retained-payload",
		Retain:  true,
	})
	if err != nil {
		t.Fatalf("expected no error publishing retained message, got %v", err)
	}

	localConnection := getNewConnectionWithCustomProperties(app, &models.Connection{
		MqttVersion: "3",
	})
	connId := localConnection.ConnectionId
	if err := app.ConnectMqtt(connId); err != nil {
		t.Fatalf("expected no error connecting, got %v", err)
	}
	defer app.DisconnectMqtt(connId)

	appConnection := app.AppConnections[connId]
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		if appConnection.MqttManager.MessageHistory.IsRetained(topic) {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("timed out waiting for the retained message to be indexed")
		default:
			time.Sleep(100 * time.Millisecond)
		}
	}

	if err := app.DeleteRetainedMessage(connId, topic); err != nil {
		t.Fatalf("expected no error clearing the retained message, got %v", err)
	}

	// v3 never echoes the tombstone back, so this must already be false the
	// instant DeleteRetainedMessage returns.
	if appConnection.MqttManager.MessageHistory.IsRetained(topic) {
		t.Error("expected the retained index to be unmarked immediately after DeleteRetainedMessage")
	}
}
