package app

import "testing"

// Broker-free coverage of the Sparkplug App methods' guard paths. The happy
// paths (decode, alias resolution, rebirth encoding) are covered in the
// sparkplug and mqtt-middleware packages.

func TestGetSparkplugMessageHistoryUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if _, err := app.GetSparkplugMessageHistory(999); err == nil {
		t.Error("Expected error for unknown connection, got nil")
	}
}

func TestGetSparkplugMessageHistoryEmptyForFreshConnection(t *testing.T) {
	app := getSeededTestApp(t)
	messages, err := app.GetSparkplugMessageHistory(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(messages) != 0 {
		t.Errorf("Expected no messages for a fresh connection, got %v", len(messages))
	}
}

func TestPublishSparkplugRebirthRequiresGroupAndNode(t *testing.T) {
	app := getSeededTestApp(t)
	if err := app.PublishSparkplugRebirth(1, "", "node"); err == nil {
		t.Error("Expected error for empty group, got nil")
	}
	if err := app.PublishSparkplugRebirth(1, "group", ""); err == nil {
		t.Error("Expected error for empty edge node, got nil")
	}
}

func TestPublishSparkplugRebirthUnknownConnection(t *testing.T) {
	app := getTestApp(t)
	if err := app.PublishSparkplugRebirth(999, "group", "node"); err == nil {
		t.Error("Expected error for unknown connection, got nil")
	}
}

func TestPublishSparkplugRebirthNotConnected(t *testing.T) {
	app := getSeededTestApp(t)
	if err := app.PublishSparkplugRebirth(1, "group", "node"); err == nil {
		t.Error("Expected error for disconnected connection, got nil")
	}
}
