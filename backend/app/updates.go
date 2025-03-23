package app

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/update"
)

// Exposed to frontend to call as necessary
func (a *App) CheckForUpdates() (*update.UpdateResponse, error) {
	updateResponse, err := a.Updater.CheckForUpdate()
	return updateResponse, err
}

func (a *App) StartUpdate() error {
	err := a.Updater.UpdateSelf()
	if err != nil {
		slog.ErrorContext(a.ctx, fmt.Sprintf("error updating: %s", err.Error()))
		return err
	}
	return nil
}
