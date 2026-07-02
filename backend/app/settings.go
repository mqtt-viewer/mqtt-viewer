package app

import (
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
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
