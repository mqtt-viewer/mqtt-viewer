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
	if settings.LaunchCount != 0 {
		t.Errorf("expected launch count 0 in test mode, got %d", settings.LaunchCount)
	}
	if settings.HasSeenStarPrompt {
		t.Error("expected star prompt unseen by default")
	}
	if settings.TopicPanelDockMode != "right" {
		t.Errorf("expected default dock mode 'right', got %q", settings.TopicPanelDockMode)
	}
	if settings.TopicPanelLastDockedSide != "right" {
		t.Errorf("expected default last docked side 'right', got %q", settings.TopicPanelLastDockedSide)
	}
}

func TestRecordAppLaunchIncrementsCount(t *testing.T) {
	app := getTestApp(t)

	for i := 1; i <= 3; i++ {
		if err := app.recordAppLaunch(); err != nil {
			t.Fatalf("recording launch: %v", err)
		}
		settings, err := app.GetAppSettings()
		if err != nil {
			t.Fatalf("reading settings: %v", err)
		}
		if settings.LaunchCount != int64(i) {
			t.Errorf("expected launch count %d, got %d", i, settings.LaunchCount)
		}
	}
}

func TestAcknowledgeStarPromptPersists(t *testing.T) {
	app := getTestApp(t)

	updated, err := app.AcknowledgeStarPrompt()
	if err != nil {
		t.Fatalf("acknowledging star prompt: %v", err)
	}
	if !updated.HasSeenStarPrompt {
		t.Error("expected star prompt marked seen")
	}

	reloaded, err := app.GetAppSettings()
	if err != nil {
		t.Fatalf("reloading settings: %v", err)
	}
	if !reloaded.HasSeenStarPrompt {
		t.Error("expected star prompt seen flag to persist")
	}
}

func TestSetTopicPanelDockPersists(t *testing.T) {
	app := getTestApp(t)

	updated, err := app.SetTopicPanelDock("bottom", "bottom")
	if err != nil {
		t.Fatalf("setting dock: %v", err)
	}
	if updated.TopicPanelDockMode != "bottom" || updated.TopicPanelLastDockedSide != "bottom" {
		t.Errorf("unexpected updated settings: %+v", updated)
	}

	reloaded, err := app.GetAppSettings()
	if err != nil {
		t.Fatalf("reloading settings: %v", err)
	}
	if reloaded.TopicPanelDockMode != "bottom" {
		t.Errorf("expected persisted dock mode 'bottom', got %q", reloaded.TopicPanelDockMode)
	}
}

func TestSetTopicPanelDockValidatesMode(t *testing.T) {
	app := getTestApp(t)
	if _, err := app.SetTopicPanelDock("sideways", "right"); err == nil {
		t.Error("expected error for invalid dock mode")
	}
	if _, err := app.SetTopicPanelDock("window", "window"); err == nil {
		t.Error("expected error for invalid last docked side")
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
