package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/events"

	"gorm.io/gorm"
)

// GetAppSettings returns the singleton settings row (seeded by migration).
func (a *App) GetAppSettings() (models.AppSettings, error) {
	var settings models.AppSettings
	if err := a.Db.First(&settings, 1).Error; err != nil {
		return models.AppSettings{}, err
	}
	return settings, nil
}

type UpdateAppSettingsParams struct {
	MemoryBudgetBytes    int64 `json:"memoryBudgetBytes"`
	RecordingEnabled     bool  `json:"recordingEnabled"`
	DiskBudgetBytes      int64 `json:"diskBudgetBytes"`
	HasSeenHistoryPrompt bool  `json:"hasSeenHistoryPrompt"`
}

func (a *App) UpdateAppSettings(params UpdateAppSettingsParams) (models.AppSettings, error) {
	var settings models.AppSettings
	if err := a.Db.First(&settings, 1).Error; err != nil {
		return models.AppSettings{}, err
	}
	settings.MemoryBudgetBytes = params.MemoryBudgetBytes
	settings.RecordingEnabled = params.RecordingEnabled
	settings.DiskBudgetBytes = params.DiskBudgetBytes
	settings.HasSeenHistoryPrompt = params.HasSeenHistoryPrompt
	if err := a.Db.Save(&settings).Error; err != nil {
		return models.AppSettings{}, err
	}
	// Apply the (possibly changed) in-RAM budget live to every connection, and
	// refresh the cached recording flag + disk budget read on the drain path.
	a.applyMemoryBudgetToAllConnections(settings.MemoryBudgetBytes)
	a.recordingEnabled.Store(settings.RecordingEnabled)
	a.diskBudgetBytes.Store(settings.DiskBudgetBytes)
	return settings, nil
}

// AcknowledgeChangelog records that the user has seen the "What's new" dialog
// for the given app version, so it isn't shown again until the next update.
func (a *App) AcknowledgeChangelog(version string) (models.AppSettings, error) {
	var settings models.AppSettings
	if err := a.Db.First(&settings, 1).Error; err != nil {
		return models.AppSettings{}, err
	}
	settings.LastSeenChangelogVersion = version
	if err := a.Db.Save(&settings).Error; err != nil {
		return models.AppSettings{}, err
	}
	return settings, nil
}

// AcknowledgeStarPrompt records that the user has seen the "star us on GitHub"
// prompt, so it never shows again (whether they starred or dismissed it).
func (a *App) AcknowledgeStarPrompt() (models.AppSettings, error) {
	var settings models.AppSettings
	if err := a.Db.First(&settings, 1).Error; err != nil {
		return models.AppSettings{}, err
	}
	settings.HasSeenStarPrompt = true
	if err := a.Db.Save(&settings).Error; err != nil {
		return models.AppSettings{}, err
	}
	return settings, nil
}

// recordAppLaunch bumps the persisted launch counter. It gates one-time nudges
// (like the GitHub star prompt) so they never hit a fresh install on first run.
func (a *App) recordAppLaunch() error {
	return a.Db.Model(&models.AppSettings{}).Where("id = ?", 1).
		UpdateColumn("launch_count", gorm.Expr("launch_count + 1")).Error
}

// TopicPanelDockChangedPayload is the payload emitted on TopicPanelDockChanged
// so every window (main and any topic pop-outs) converges on the same dock
// state, since localStorage would not propagate across separate webviews.
type TopicPanelDockChangedPayload struct {
	Mode           string `json:"mode"`
	LastDockedSide string `json:"lastDockedSide"`
}

// SetTopicPanelDock validates and persists the dockable selected-topic
// panel's global dock state, then emits TopicPanelDockChanged so every
// window converges. If the new mode is no longer "window", any open topic
// pop-out windows are closed (their own WindowClosing handler sees the mode
// has already left "window" and so does not revert it again).
func (a *App) SetTopicPanelDock(mode string, lastDockedSide string) (models.AppSettings, error) {
	if mode != "right" && mode != "bottom" && mode != "window" {
		return models.AppSettings{}, fmt.Errorf("invalid dock mode %q", mode)
	}
	if lastDockedSide != "right" && lastDockedSide != "bottom" {
		return models.AppSettings{}, fmt.Errorf("invalid last docked side %q", lastDockedSide)
	}

	var settings models.AppSettings
	if err := a.Db.First(&settings, 1).Error; err != nil {
		return models.AppSettings{}, err
	}
	settings.TopicPanelDockMode = mode
	settings.TopicPanelLastDockedSide = lastDockedSide
	if err := a.Db.Save(&settings).Error; err != nil {
		return models.AppSettings{}, err
	}

	// EventRuntime is only wired up when running under the real Wails app
	// (see Startup); guard so this is safely callable from unit tests too.
	if a.EventRuntime != nil {
		a.EventRuntime.EventsEmit(string(events.TopicPanelDockChanged), TopicPanelDockChangedPayload{
			Mode:           mode,
			LastDockedSide: lastDockedSide,
		})
	}

	if mode != "window" {
		closeAllTopicWindows()
	}

	return settings, nil
}

// memoryBudgetBytes returns the configured in-RAM budget, falling back to the
// default if settings are unavailable or unset.
func (a *App) memoryBudgetBytes() int64 {
	settings, err := a.GetAppSettings()
	if err != nil || settings.MemoryBudgetBytes <= 0 {
		return mqtt.DefaultMemoryBudgetBytes
	}
	return settings.MemoryBudgetBytes
}

func (a *App) applyMemoryBudgetToAllConnections(budget int64) {
	if budget <= 0 {
		budget = mqtt.DefaultMemoryBudgetBytes
	}
	for _, conn := range a.AppConnections {
		if conn != nil && conn.MqttManager != nil {
			conn.MqttManager.SetMessageMemoryBudget(budget)
		}
	}
}
