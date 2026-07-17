package app

import (
	"strings"
	"testing"
)

// The retained index itself is covered in backend/mqtt (history_test.go), which
// can exercise it without a broker. These cover the app layer's own contract:
// how it reports partial failure, and how it handles a connection that isn't
// there.

func TestDeleteRetainedMessagesReportsHowManyFailed(t *testing.T) {
	app := getTestApp(t)

	// No connection with this id, so every publish fails. The point is that it
	// attempts all of them and reports counts, rather than aborting on the
	// first: a half-cleared branch that reports nothing is worse than a full
	// attempt that says what broke.
	err := app.DeleteRetainedMessages(999, []string{"a/one", "a/two", "a/three"})
	if err == nil {
		t.Fatal("expected an error when every topic fails")
	}
	if !strings.Contains(err.Error(), "cleared 0 of 3") {
		t.Errorf("error should say how many succeeded and how many failed, got: %v", err)
	}
	if !strings.Contains(err.Error(), "3 failed") {
		t.Errorf("error should report the failure count, got: %v", err)
	}
}

func TestDeleteRetainedMessagesWithNoTopicsIsANoop(t *testing.T) {
	app := getTestApp(t)

	// The caller filters the prefix itself out of the list, so an empty list is
	// reachable and must not be treated as a failure.
	if err := app.DeleteRetainedMessages(999, nil); err != nil {
		t.Errorf("clearing nothing should succeed, got: %v", err)
	}
	if err := app.DeleteRetainedMessages(999, []string{}); err != nil {
		t.Errorf("clearing an empty list should succeed, got: %v", err)
	}
}

func TestGetRetainedTopicsUnderPrefixErrorsForUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.GetRetainedTopicsUnderPrefix(999, "a/b"); err == nil {
		t.Error("expected an error for a connection that does not exist")
	}
}
