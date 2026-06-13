package update

import (
	"context"
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/backend/logging"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

const releasesPageUrl = "https://github.com/mqtt-viewer/mqtt-viewer/releases"

// UpdateResponse is what the frontend receives from a manual / periodic
// update check. CanUpdate is false when the install cannot self-update
// (e.g. AppImage, deb/rpm installs) or the license does not cover the
// new version - in those cases NotificationUrl points the user at the
// right place instead.
type UpdateResponse struct {
	LatestVersion    string `json:"latest_version"`
	CanUpdate        bool   `json:"can_update"`
	ReleaseNotes     string `json:"release_notes"`
	NotificationText string `json:"notification_text"`
	NotificationUrl  string `json:"notification_url"`
}

// Updater bridges the app's update UX to the Wails v3 updater. The check
// flow (periodic, notification-driven) talks to the portal directly; the
// install flow hands over to app.Updater, which downloads, verifies and
// stages the update through the built-in updater window.
type Updater struct {
	logCtx context.Context
	app    *application.App
}

// InitUpdater configures the Wails v3 updater with the portal provider and
// returns the app-facing wrapper around it.
func InitUpdater(app *application.App) (*Updater, error) {
	logCtx := logging.AppendCtx(context.Background(), slog.String("module", "updater"))

	err := app.Updater.Init(updater.Config{
		CurrentVersion: strings.TrimPrefix(env.Version, "v"),
		Providers:      []updater.Provider{NewPortalProvider()},
	})
	if err != nil {
		return nil, fmt.Errorf("updater: %w", err)
	}

	return &Updater{
		logCtx: logCtx,
		app:    app,
	}, nil
}

// CheckForUpdate queries the portal and returns information about an
// available update, or nil if the app is up to date.
func (u *Updater) CheckForUpdate() (*UpdateResponse, error) {
	info, err := fetchUpdateInfo(env.Version)
	if err != nil {
		return nil, fmt.Errorf("updater: %w", err)
	}

	if info.UpToDate || sameVersion(info.LatestVersion, env.Version) {
		slog.InfoContext(u.logCtx, "current version is the latest")
		return nil, nil
	}

	response := &UpdateResponse{
		LatestVersion:    info.LatestVersion,
		CanUpdate:        info.CanUpdate,
		ReleaseNotes:     info.ReleaseNotes,
		NotificationText: info.NotificationText,
		NotificationUrl:  info.NotificationUrl,
	}

	if !info.CanUpdate {
		slog.InfoContext(u.logCtx, fmt.Sprintf("new version %s available but not licensed for this machine", info.LatestVersion))
		return response, nil
	}

	if !canSelfUpdate() {
		// Package-managed installs (AppImage, deb, rpm or any install the
		// current user cannot write to) cannot swap their own binary.
		response.CanUpdate = false
		if response.NotificationUrl == "" {
			response.NotificationUrl = releasesPageUrl
		}
		if response.NotificationText == "" {
			response.NotificationText = fmt.Sprintf("%s of MQTT Viewer is available. Click here to download.", info.LatestVersion)
		}
		slog.InfoContext(u.logCtx, fmt.Sprintf("new version %s available (not self-updatable, notifying only)", info.LatestVersion))
		return response, nil
	}

	slog.InfoContext(u.logCtx, fmt.Sprintf("new version %s available", info.LatestVersion))
	return response, nil
}

// StartUpdate kicks off the Wails v3 update flow: the built-in updater
// window opens and walks the user through download, verification and
// restart. Runs asynchronously; progress and errors surface through the
// updater window and wails:updater:* events.
func (u *Updater) StartUpdate() error {
	if !canSelfUpdate() {
		return fmt.Errorf("updater: this installation cannot self-update")
	}
	go func() {
		if err := u.app.Updater.CheckAndInstall(context.Background()); err != nil {
			slog.ErrorContext(u.logCtx, fmt.Sprintf("update failed: %v", err))
		}
	}()
	return nil
}
