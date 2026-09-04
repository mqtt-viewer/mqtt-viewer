package app

import (
	"mqtt-viewer/backend/models"
	"testing"
	"time"
)

// A topic tombstoned while we were disconnected must not survive the
// reconnect. The index is cleared before we resubscribe, so what comes back is
// whatever the broker replays, not whatever we happened to know last time.
//
// This is the claim the bulk-clear count rests on: without the reset, topics
// cleared by anyone else while the app was away stay marked forever and inflate
// every count below them.
func TestRetainedIndexRebuildsFromReplayOnReconnect(t *testing.T) {
	app := getTestApp(t)
	base := "gotest121/" + t.Name()

	zero := uint(0)
	pubConn := getNewConnectionWithCustomProperties(app, &models.Connection{
		MqttVersion:   "3",
		Subscriptions: []models.Subscription{{Topic: base + "/_unused", QoS: &zero}},
	})
	if err := app.ConnectMqtt(pubConn.ConnectionId); err != nil {
		t.Fatalf("publisher connect: %v", err)
	}
	defer app.DisconnectMqtt(pubConn.ConnectionId)
	pub := func(topic, payload string) {
		if err := app.PublishMqtt(pubConn.ConnectionId, PublishParams{
			Topic: topic, QoS: 1, Payload: payload, Retain: true,
		}); err != nil {
			t.Fatalf("publish %s: %v", topic, err)
		}
	}
	defer func() {
		pub(base+"/a/one", "")
		pub(base+"/a/two", "")
	}()

	pub(base+"/a/one", "v1")
	pub(base+"/a/two", "v1")

	sub := getNewConnectionWithCustomProperties(app, &models.Connection{
		MqttVersion:   "3",
		Subscriptions: []models.Subscription{{Topic: base + "/#", QoS: &zero}},
	})
	connId := sub.ConnectionId
	if err := app.ConnectMqtt(connId); err != nil {
		t.Fatalf("subscriber connect: %v", err)
	}
	appConnection, ok := app.appConnection(connId)
	if !ok {
		t.Fatalf("subscriber connection %d not registered", connId)
	}
	hist := appConnection.MqttManager.MessageHistory

	waitFor := func(want int) []string {
		deadline := time.Now().Add(5 * time.Second)
		var got []string
		for time.Now().Before(deadline) {
			got = hist.RetainedUnderPrefix(base + "/a")
			if len(got) == want {
				return got
			}
			time.Sleep(150 * time.Millisecond)
		}
		return got
	}

	got := waitFor(2)
	t.Logf("after first connect: %v", got)
	if len(got) != 2 {
		t.Fatalf("expected 2 retained under %s/a on first connect, got %v", base, got)
	}

	app.DisconnectMqtt(connId)
	time.Sleep(500 * time.Millisecond)
	pub(base+"/a/one", "") // tombstone while we are away
	time.Sleep(500 * time.Millisecond)

	if err := app.ConnectMqtt(connId); err != nil {
		t.Fatalf("reconnect: %v", err)
	}
	defer app.DisconnectMqtt(connId)

	got = waitFor(1)
	t.Logf("after reconnect: %v", got)
	if len(got) != 1 || got[0] != base+"/a/two" {
		t.Errorf("expected only %s/a/two after reconnect, got %v", base, got)
	}
}
