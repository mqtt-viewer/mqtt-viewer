package app

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/update"
)

// Exposed to frontend to call as necessary
func (a *App) CheckForUpdates() (*update.UpdateResponse, error) {
	// The updater is never initialised in server mode (Docker images update by
	// pulling a new image), so the frontend's check is a no-op rather than a panic.
	if a.Updater == nil {
		return nil, nil
	}
	updateResponse, err := a.Updater.CheckForUpdate()
	return updateResponse, err
}

func (a *App) StartUpdate() error {
	if a.Updater == nil {
		return nil
	}
	err := a.Updater.StartUpdate()
	if err != nil {
		slog.ErrorContext(a.ctx, fmt.Sprintf("error updating: %s", err.Error()))
		return err
	}
	return nil
}
