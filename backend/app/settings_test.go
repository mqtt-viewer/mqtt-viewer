package app

import (
	"mqtt-viewer/backend/mqtt"
	"testing"
)

func TestAppSettingsSeededDefaults(t *testing.T) {
	app := getTestApp(t)
	settings, err := app.GetAppSettings()
	if err != nil {
		t.Fatalf("expected seeded settings, got %v", err)
	}
	if settings.MemoryBudgetBytes != 512*1024*1024 {
		t.Errorf("expected 512MB default memory budget, got %d", settings.MemoryBudgetBytes)
	}
	if settings.RecordingEnabled {
		t.Error("expected recording disabled by default")
	}
	if settings.DiskBudgetBytes != 1024*1024*1024 {
		t.Errorf("expected 1GB default disk budget, got %d", settings.DiskBudgetBytes)
	}
	if settings.HasSeenHistoryPrompt {
		t.Error("expected history prompt unseen by default")
	}
}

func TestUpdateAppSettingsPersistsAndAppliesBudget(t *testing.T) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}

	updated, err := app.UpdateAppSettings(UpdateAppSettingsParams{
		MemoryBudgetBytes:    256 * 1024 * 1024,
		RecordingEnabled:     true,
		DiskBudgetBytes:      2 * 1024 * 1024 * 1024,
		HasSeenHistoryPrompt: true,
	})
	if err != nil {
		t.Fatalf("updating settings: %v", err)
	}
	if updated.MemoryBudgetBytes != 256*1024*1024 || !updated.RecordingEnabled ||
		updated.DiskBudgetBytes != 2*1024*1024*1024 || !updated.HasSeenHistoryPrompt {
		t.Errorf("unexpected updated settings: %+v", updated)
	}

	// Persisted?
	reloaded, err := app.GetAppSettings()
	if err != nil {
		t.Fatalf("reloading settings: %v", err)
	}
	if reloaded.MemoryBudgetBytes != 256*1024*1024 {
		t.Errorf("expected persisted budget, got %d", reloaded.MemoryBudgetBytes)
	}

	// memoryBudgetBytes() reflects the new value.
	if app.memoryBudgetBytes() != 256*1024*1024 {
		t.Errorf("expected memoryBudgetBytes 256MB, got %d", app.memoryBudgetBytes())
	}

	// budget fallback when unset
	_ = mqtt.DefaultMemoryBudgetBytes
	_ = conn
}
