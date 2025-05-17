package update

import (
	"context"
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/backend/logging"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/blang/semver"
)

type Updater struct {
	logCtx         context.Context
	currentVersion semver.Version
	updateResponse UpdateResponse
	resourcePath   string
}

func NewUpdater(resourcePath string, machineId string) *Updater {
	logCtx := logging.AppendCtx(context.Background(), slog.String("module", "updater"))
	currentVersion := semver.MustParse(strings.TrimPrefix(env.Version, "v"))
	return &Updater{
		logCtx:         logCtx,
		currentVersion: currentVersion,
		resourcePath:   resourcePath,
	}
}

func (u *Updater) CheckForUpdate() (*UpdateResponse, error) {
	machineId := env.MachineId
	arch := runtime.GOARCH
	os := runtime.GOOS

	updateResponse, err := checkForUpdate(checkForUpdateParams{
		machineId:      machineId,
		currentVersion: env.Version,
		os:             os,
		arch:           arch,
	})
	if err != nil {
		return nil, newUpdaterError(err)
	}

	u.updateResponse = updateResponse

	isAppimage := env.IsAppImage == "true"
	if isAppimage {
		u.updateResponse.UpdateUrl = ""
		u.updateResponse.NotificationUrl = "https://github.com/mqtt-viewer/mqtt-viewer/releases"
		u.updateResponse.NotificationText = "A new update is available via AppImage. Click here to download."
	}

	if updateResponse.LatestVersion == env.Version || strings.TrimPrefix(updateResponse.LatestVersion, "v") == env.Version {
		slog.InfoContext(u.logCtx, "current version is the latest")
		return nil, nil
	}

	if !updateResponse.CanUpdate {
		slog.InfoContext(u.logCtx, "no updates available")
	} else {
		slog.InfoContext(u.logCtx, fmt.Sprintf("new version %s available", updateResponse.LatestVersion))
	}
	return &updateResponse, nil
}

func (u *Updater) UpdateSelf() error {
	if !u.updateResponse.CanUpdate {
		return fmt.Errorf("no updates available")
	}
	newVersion := u.updateResponse.LatestVersion
	updateUrl := u.updateResponse.UpdateUrl
	os := runtime.GOOS
	ctx := u.logCtx

	newV, err := semver.Parse(strings.TrimPrefix(newVersion, "v"))
	if err != nil {
		return fmt.Errorf("new version does not meet semver: %s", newVersion)
	}
	if u.currentVersion.GTE(newV) {
		return fmt.Errorf("current version %s is the latest", u.currentVersion)
	}

	downloadDir := filepath.Join(u.resourcePath, "downloads")
	if os == "darwin" || os == "windows" {
		return newUpdaterError(selfUpdate(ctx, os, downloadDir, newVersion, updateUrl))
	} else if os == "linux" {
		return newUpdaterError(selfUpdate(ctx, os, downloadDir, newVersion, updateUrl))
	}
	return newUpdaterError(fmt.Errorf("unsupported OS"))
}

func newUpdaterError(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("updater: %w", err)
}
