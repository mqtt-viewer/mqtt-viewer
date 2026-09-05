package app

import (
	"mqtt-viewer/backend/models"
	"testing"
)

func pinnedTopicNames(t *testing.T, app *App, connectionID uint) []string {
	t.Helper()
	pinned, err := app.GetPinnedTopics(connectionID)
	if err != nil {
		t.Fatalf("getting pinned topics: %v", err)
	}
	topics := make([]string, 0, len(pinned))
	for _, pin := range pinned {
		topics = append(topics, pin.Topic)
	}
	return topics
}

func assertPinnedOrder(t *testing.T, app *App, connectionID uint, want ...string) {
	t.Helper()
	got := pinnedTopicNames(t, app, connectionID)
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}

func TestPinTopicAppendsInOrder(t *testing.T) {
	app, connID := getTestAppWithConnection(t)

	for _, topic := range []string{"a/one", "b/two", "c/three"} {
		if err := app.PinTopic(connID, topic); err != nil {
			t.Fatalf("pinning %s: %v", topic, err)
		}
	}

	assertPinnedOrder(t, app, connID, "a/one", "b/two", "c/three")
}

func TestPinTopicIsScopedToConnection(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	other, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating second connection: %v", err)
	}

	if err := app.PinTopic(connID, "a/one"); err != nil {
		t.Fatalf("pinning: %v", err)
	}
	if err := app.PinTopic(other.ConnectionDetails.ID, "b/two"); err != nil {
		t.Fatalf("pinning on other connection: %v", err)
	}

	assertPinnedOrder(t, app, connID, "a/one")
	assertPinnedOrder(t, app, other.ConnectionDetails.ID, "b/two")
}

func TestPinTopicTwiceIsNoOp(t *testing.T) {
	app, connID := getTestAppWithConnection(t)

	if err := app.PinTopic(connID, "a/one"); err != nil {
		t.Fatalf("pinning: %v", err)
	}
	if err := app.PinTopic(connID, "b/two"); err != nil {
		t.Fatalf("pinning: %v", err)
	}
	if err := app.PinTopic(connID, "a/one"); err != nil {
		t.Fatalf("re-pinning: %v", err)
	}

	// the duplicate pin must not move a/one to the end, nor add a row
	assertPinnedOrder(t, app, connID, "a/one", "b/two")
}

func TestUnpinTopicKeepsRemainingOrder(t *testing.T) {
	app, connID := getTestAppWithConnection(t)

	for _, topic := range []string{"a/one", "b/two", "c/three"} {
		if err := app.PinTopic(connID, topic); err != nil {
			t.Fatalf("pinning %s: %v", topic, err)
		}
	}
	if err := app.UnpinTopic(connID, "b/two"); err != nil {
		t.Fatalf("unpinning: %v", err)
	}

	assertPinnedOrder(t, app, connID, "a/one", "c/three")

	// a later pin still appends to the end
	if err := app.PinTopic(connID, "d/four"); err != nil {
		t.Fatalf("pinning after unpin: %v", err)
	}
	assertPinnedOrder(t, app, connID, "a/one", "c/three", "d/four")
}

func TestUnpinTopicThatIsNotPinned(t *testing.T) {
	app, connID := getTestAppWithConnection(t)

	if err := app.PinTopic(connID, "a/one"); err != nil {
		t.Fatalf("pinning: %v", err)
	}
	if err := app.UnpinTopic(connID, "not/pinned"); err != nil {
		t.Fatalf("unpinning missing topic: %v", err)
	}

	assertPinnedOrder(t, app, connID, "a/one")
}

func TestUnpinAllTopicsOnlyClearsOneConnection(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	other, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating second connection: %v", err)
	}

	for _, topic := range []string{"a/one", "b/two"} {
		if err := app.PinTopic(connID, topic); err != nil {
			t.Fatalf("pinning %s: %v", topic, err)
		}
	}
	if err := app.PinTopic(other.ConnectionDetails.ID, "c/three"); err != nil {
		t.Fatalf("pinning on other connection: %v", err)
	}

	if err := app.UnpinAllTopics(connID); err != nil {
		t.Fatalf("unpinning all: %v", err)
	}

	assertPinnedOrder(t, app, connID)
	assertPinnedOrder(t, app, other.ConnectionDetails.ID, "c/three")
}

func TestDeleteConnectionDeletesPinnedTopics(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	other, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating second connection: %v", err)
	}

	if err := app.PinTopic(connID, "a/one"); err != nil {
		t.Fatalf("pinning: %v", err)
	}
	if err := app.PinTopic(other.ConnectionDetails.ID, "b/two"); err != nil {
		t.Fatalf("pinning on other connection: %v", err)
	}

	if err := app.DeleteConnection(connID); err != nil {
		t.Fatalf("deleting connection: %v", err)
	}

	var remaining []models.PinnedTopic
	if err := app.Db.Find(&remaining).Error; err != nil {
		t.Fatalf("reading pinned topics: %v", err)
	}
	if len(remaining) != 1 || remaining[0].Topic != "b/two" {
		t.Fatalf("expected only the other connection's pin to survive, got %v", remaining)
	}
}
