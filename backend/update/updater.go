package update

import (
	"context"
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/backend/logging"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

const (
	releasesPageURL = "https://github.com/mqtt-viewer/mqtt-viewer/releases"
	flatpakAppID    = "app.mqttviewer.MQTTViewer"
	// Default Nix store root. NIX_STORE_DIR overrides it, see isNixStorePath.
	nixStoreDir = "/nix/store"

	// installTypeEnv lets a deployment declare how it was installed, so the
	// frontend can show update instructions that actually apply. The image
	// sets it to "docker"; a Home Assistant add-on sets it to "home-assistant".
	installTypeEnv = "MQTT_VIEWER_INSTALL_TYPE"

	// disableCheckEnv turns the update check off entirely. Set it to 1 (or
	// true/yes) and the app never contacts the portal, at the cost of never
	// being told a new version exists.
	disableCheckEnv = "MQTT_VIEWER_DISABLE_UPDATE_CHECK"

	// checkCacheTTL is how long a portal result is reused. Every browser tab
	// polls on its own timer, so without this a shared deployment costs one
	// portal request per tab per poll.
	checkCacheTTL = 5 * time.Minute
)

// Install type identifiers reported to the frontend so it can show the right
// update instructions.
const (
	installFlatpak       = "flatpak"
	installAppImage      = "appimage"
	installNix           = "nix"
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

// Indirection so tests can pretend the binary lives somewhere else.
var osExecutable = os.Executable

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

	// The check result is cached so that N frontend clients (browser tabs in
	// server mode, plus reloads) cost one portal request per checkCacheTTL.
	// Only successful checks are cached: a failure retries on the next poll.
	// cacheMu guards the three cache fields; fetchMu serialises the portal
	// call itself, so tabs that all miss the cache at once still make one
	// request between them rather than one each.
	cacheMu    sync.Mutex
	fetchMu    sync.Mutex
	cached     *UpdateResponse
	cachedAt   time.Time
	cacheValid bool
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

	if updateCheckDisabled() {
		slog.InfoContext(logCtx, fmt.Sprintf("update check disabled by %s; this install will not contact the portal", disableCheckEnv))
	}

	return &Updater{
		logCtx: logCtx,
		app:    app,
	}, nil
}

// CheckForUpdate queries the portal and returns information about an available
// update, or nil if the app is up to date. Updates are never gated on
// licensing; the response describes how this install should be updated.
//
// The result is cached for checkCacheTTL. Every frontend client polls on its
// own timer, so a deployment with several browser tabs open would otherwise
// multiply the portal traffic by the number of tabs.
func (u *Updater) CheckForUpdate() (*UpdateResponse, error) {
	if updateCheckDisabled() {
		return nil, nil
	}

	if cached, ok := u.cachedResult(); ok {
		return cached, nil
	}

	u.fetchMu.Lock()
	defer u.fetchMu.Unlock()
	// Another caller may have filled the cache while we waited for the lock.
	if cached, ok := u.cachedResult(); ok {
		return cached, nil
	}

	info, err := fetchUpdate(env.Version)
	if err != nil {
		return nil, fmt.Errorf("updater: %w", err)
	}

	if info.UpToDate || sameVersion(info.LatestVersion, env.Version) {
		slog.InfoContext(u.logCtx, "current version is the latest")
		u.cacheResult(nil)
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
	u.cacheResult(response)
	return response, nil
}

// cachedResult returns the cached check result when it is still fresh. The
// second return value distinguishes "cached, and there is no update" from
// "nothing cached".
func (u *Updater) cachedResult() (*UpdateResponse, bool) {
	u.cacheMu.Lock()
	defer u.cacheMu.Unlock()
	if !u.cacheValid || time.Since(u.cachedAt) >= checkCacheTTL {
		return nil, false
	}
	if u.cached == nil {
		return nil, true
	}
	// Hand out a copy so a caller cannot mutate the cached response.
	response := *u.cached
	return &response, true
}

func (u *Updater) cacheResult(response *UpdateResponse) {
	u.cacheMu.Lock()
	defer u.cacheMu.Unlock()
	u.cached = response
	u.cachedAt = time.Now()
	u.cacheValid = true
}

// updateCheckDisabled reports whether the user has turned the update check off.
// Self-hosted installs are the ones that ask for this: the check is the only
// outbound call the app makes on its own, and some deployments want none.
func updateCheckDisabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(disableCheckEnv))) {
	case "1", "true", "yes":
		return true
	}
	return false
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

// isNixStorePath reports whether p sits inside the Nix store. Store paths are
// immutable, so a binary living under one can never replace itself in place.
// NIX_STORE_DIR is honoured for the rare non-default store root; it is normally
// unset at runtime, in which case the default applies.
func isNixStorePath(p string) bool {
	root := os.Getenv("NIX_STORE_DIR")
	if root == "" {
		root = nixStoreDir
	}
	root = strings.TrimSuffix(filepath.Clean(root), string(os.PathSeparator))
	return strings.HasPrefix(filepath.Clean(p), root+string(os.PathSeparator))
}

// isNixInstall reports whether Nix installed this binary. `nix profile add`
// leaves a symlink in ~/.nix-profile/bin, so resolve it first: the real path is
// what decides. A failed resolve is not fatal, the unresolved path is still
// worth checking.
func isNixInstall() bool {
	exe, err := osExecutable()
	if err != nil {
		return false
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return isNixStorePath(exe)
}

// resolveInstallType classifies how MQTT Viewer was installed so the frontend
// can show the correct update instructions. Server builds are containers and
// are classified from the deployment environment (Docker or a Home Assistant
// add-on). On the desktop, Flatpak, AppImage and Nix each identify themselves
// (the first two through environment variables, Nix through its immutable
// store path); everything else is classified by OS, with Linux split into a
// self-updatable portable binary and a system package (deb/rpm).
func resolveInstallType() string {
	if env.IsServerBuild {
		// A container never falls through to the desktop classification. The
		// deployment sets MQTT_VIEWER_INSTALL_TYPE to "home-assistant" when the
		// image runs as an add-on; anything else (or unset) is a plain Docker
		// run. Match loosely: the value is typed by hand into an add-on config
		// or a compose file, so stray whitespace and capitals are likely.
		declared := strings.ToLower(strings.TrimSpace(os.Getenv(installTypeEnv)))
		if declared == "home-assistant" || declared == installHomeAssistant {
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
	// Ahead of the OS switch: a Nix install looks identical on Linux and macOS,
	// and the store path is immutable either way.
	if isNixInstall() {
		return installNix
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
	case installNix:
		return "nix profile upgrade --all",
			"Update MQTT Viewer through Nix. If you installed it into your profile, run:",
			""
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
