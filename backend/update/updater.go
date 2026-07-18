package update

import (
	"context"
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/backend/logging"
	"os"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

const (
	releasesPageURL = "https://github.com/mqtt-viewer/mqtt-viewer/releases"
	flatpakAppID    = "app.mqttviewer.MQTTViewer"
)

// Install type identifiers reported to the frontend so it can show the right
// update instructions.
const (
	installFlatpak       = "flatpak"
	installAppImage      = "appimage"
	installLinuxPackage  = "linux-package" // deb or rpm
	installLinuxPortable = "linux-portable"
	installMacOS         = "macos"
	installWindows       = "windows"
	// Server (headless) builds. These never self-update; a container is
	// replaced by pulling a new image, so the frontend only shows how to do
	// that. installDocker is the default; installHomeAssistant is used when
	// the image runs as a Home Assistant add-on, where updates flow through
	// the add-on store instead.
	installDocker        = "docker"
	installHomeAssistant = "home-assistant-addon"
)

// UpdateResponse is what the frontend receives when an update is available.
// There is no licensing, so an update is always offered when a newer version
// exists. CanSelfUpdate decides whether the app updates itself through the
// built-in updater or the user follows install-type-specific instructions.
type UpdateResponse struct {
	LatestVersion string `json:"latest_version"`
	ReleaseNotes  string `json:"release_notes"`
	CanSelfUpdate bool   `json:"can_self_update"`
	InstallType   string `json:"install_type"`
	UpdateCommand string `json:"update_command"`
	Instructions  string `json:"instructions"`
	ReleasesUrl   string `json:"releases_url"`
}

// Updater bridges the app's update UX to the Wails v3 updater. The check flow
// (periodic, notification-driven) talks to the portal directly; the install
// flow hands over to app.Updater, which downloads, verifies and stages the
// update through the built-in updater window.
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

// CheckForUpdate queries the portal and returns information about an available
// update, or nil if the app is up to date. Updates are never gated on
// licensing; the response describes how this install should be updated.
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
		LatestVersion: info.LatestVersion,
		ReleaseNotes:  info.ReleaseNotes,
		CanSelfUpdate: canSelfUpdate(),
		InstallType:   resolveInstallType(),
	}
	response.UpdateCommand, response.Instructions, response.ReleasesUrl = updateGuidance(response.InstallType)

	slog.InfoContext(u.logCtx, fmt.Sprintf("new version %s available (install type %s, self-update %t)", info.LatestVersion, response.InstallType, response.CanSelfUpdate))
	return response, nil
}

// StartUpdate kicks off the Wails v3 update flow: the built-in updater window
// opens and walks the user through download, verification and restart. Runs
// asynchronously; progress and errors surface through the updater window and
// wails:updater:* events.
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

// canSelfUpdate reports whether this installation can replace its own binary.
// Server (container) builds never can, regardless of file permissions, because
// they are updated by pulling a new image rather than swapping the binary in
// place. Everything else defers to the platform-specific check.
func canSelfUpdate() bool {
	if env.IsServerBuild {
		return false
	}
	return binaryIsSelfUpdatable()
}

// isFlatpak reports whether the app is running inside a Flatpak sandbox.
// Flatpak sets FLATPAK_ID for every sandboxed process.
func isFlatpak() bool {
	return os.Getenv("FLATPAK_ID") != ""
}

// resolveInstallType classifies how MQTT Viewer was installed so the frontend
// can show the correct update instructions. Server builds are containers and
// are classified from the deployment environment; on the desktop, flatpak and
// AppImage set their own environment variables and everything else is
// classified by OS, with Linux split into a self-updatable portable binary and
// a system package (deb/rpm).
func resolveInstallType() string {
	if env.IsServerBuild {
		// A container never falls through to the desktop classification. The
		// deployment sets MQTT_VIEWER_INSTALL_TYPE to "home-assistant" when the
		// image runs as an add-on; anything else (or unset) is a plain Docker
		// run.
		if os.Getenv("MQTT_VIEWER_INSTALL_TYPE") == "home-assistant" {
			return installHomeAssistant
		}
		return installDocker
	}
	if isFlatpak() {
		return installFlatpak
	}
	if os.Getenv("APPIMAGE") != "" {
		return installAppImage
	}
	switch runtime.GOOS {
	case "darwin":
		return installMacOS
	case "windows":
		return installWindows
	default:
		if canSelfUpdate() {
			return installLinuxPortable
		}
		return installLinuxPackage
	}
}

// updateGuidance returns the shell command, human instructions and download URL
// to show for an install type. Self-updatable types (macOS, Windows, Linux
// portable) return empty command/instructions: the app updates itself through
// the built-in updater instead.
func updateGuidance(installType string) (command, instructions, releasesURL string) {
	switch installType {
	case installFlatpak:
		return "flatpak update " + flatpakAppID,
			"Update MQTT Viewer through your software centre, or run:",
			""
	case installAppImage:
		return "",
			"Download the latest AppImage from the releases page and replace your current one.",
			releasesPageURL
	case installLinuxPackage:
		return "",
			"Download the .deb or .rpm for your distribution from the releases page and install it over your current version.",
			releasesPageURL
	case installDocker:
		return "docker pull ghcr.io/mqtt-viewer/mqtt-viewer:latest",
			"Pull the new image and recreate the container:",
			releasesPageURL
	case installHomeAssistant:
		// Updates come through Home Assistant's add-on store, so there is no
		// command to run and no releases page to point at.
		return "",
			"Update the MQTT Viewer add-on from the add-on store in Home Assistant.",
			""
	default:
		return "", "", releasesPageURL
	}
}
