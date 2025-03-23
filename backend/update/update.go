package update

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/util"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/fynelabs/selfupdate"
)

func selfUpdate(ctx context.Context, osRunning string, downloadDir string, updateVersion string, updateUrl string) (err error) {
	dlFileName := path.Base(updateUrl)
	downloadPath := filepath.Join(downloadDir, dlFileName)
	err = util.DownloadFile(util.DownloadFileParams{
		LogCtx: ctx,
		Url:    updateUrl,
		Dest:   downloadPath,
	})
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("download error: %v", err))
		return err
	}
	defer func() {
		err := util.RemoveFile(util.RemoveFileParams{
			LogCtx: ctx,
			Path:   downloadPath,
		})
		if err != nil {
			slog.WarnContext(ctx, fmt.Sprintf("error removing downloaded file: %s", err))
		}
	}()

	unzippedPath := path.Join(downloadDir, strings.TrimSuffix(dlFileName, ".zip"))
	err = util.Unzip(ctx, downloadPath, unzippedPath)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("unzip error: %v", err))
		return err
	}
	defer func() {
		err := util.RemoveFile(util.RemoveFileParams{
			LogCtx: ctx,
			Path:   unzippedPath,
		})
		if err != nil {
			slog.WarnContext(ctx, fmt.Sprintf("error removing unzipped file: %s", err))
		}
	}()

	var binPath string
	if osRunning == "darwin" {
		binPath, err = GetMacBinaryPathFromZipPath(ctx, unzippedPath)
		if err != nil {
			slog.ErrorContext(ctx, fmt.Sprintf("error getting binary path: %v", err))
			return err
		}
	} else if osRunning == "windows" {
		binPath, err = GetWindowsBinaryPathFromZipPath(ctx, unzippedPath)
		if err != nil {
			slog.ErrorContext(ctx, fmt.Sprintf("error getting binary path: %v", err))
			return err
		}
	} else if osRunning == "linux" {
		binPath, err = GetLinuxBinaryPathFromZipPath(ctx, unzippedPath)
	} else {
		slog.ErrorContext(ctx, fmt.Sprintf("unsupported os: %s", osRunning))
		return fmt.Errorf("unsupported os: %s", osRunning)
	}

	slog.InfoContext(ctx, fmt.Sprintf("applying update from %s", binPath))

	// copy update into a buffer in memory
	fileLen, err := os.Stat(binPath)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("error getting file size: %v", err))
		return err
	}

	fileBuffer := make([]byte, fileLen.Size())
	fileReader, err := os.Open(binPath)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("error opening file: %v", err))
		return err
	}

	_, err = fileReader.Read(fileBuffer)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("error reading new binary into memory: %v", err))
		return
	}
	fileReader.Close()

	reader := bytes.NewReader(fileBuffer)
	selfupdate.LogDebug = slog.Debug
	selfupdate.LogInfo = slog.Info
	selfupdate.LogError = slog.Error

	err = selfupdate.Apply(reader, selfupdate.Options{})
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("error applying update: %v", err))
		return
	}

	err = util.RemoveFile(util.RemoveFileParams{
		LogCtx: ctx,
		Path:   downloadPath,
	})
	if err != nil {
		slog.WarnContext(ctx, fmt.Sprintf("error removing downloaded file: %s", err))
	}

	slog.InfoContext(ctx, fmt.Sprintf("successfully updated to version %s", updateVersion))
	slog.InfoContext(ctx, "restarting...")

	restartSelf()
	return nil
}

func GetMacBinaryPathFromZipPath(ctx context.Context, unzippedPath string) (string, error) {
	entries, err := os.ReadDir(unzippedPath)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("error reading directory: %v", err))
		return "", err
	}
	fileName := entries[0].Name()

	binDir := path.Join(unzippedPath, fileName, "Contents", "MacOS")
	entries, err = os.ReadDir(binDir)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("error reading directory: %v", err))
		return "", err
	}
	binName := entries[0].Name()
	binPath := path.Join(binDir, binName)
	return binPath, nil
}

func GetWindowsBinaryPathFromZipPath(ctx context.Context, unzippedPath string) (string, error) {
	entries, err := os.ReadDir(unzippedPath)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("error reading directory: %v", err))
		return "", err
	}
	fileName := entries[0].Name()

	binPath := path.Join(unzippedPath, fileName)
	return binPath, nil
}

func GetLinuxBinaryPathFromZipPath(ctx context.Context, unzippedPath string) (string, error) {
	entries, err := os.ReadDir(unzippedPath)
	if err != nil {
		slog.ErrorContext(ctx, fmt.Sprintf("error reading directory: %v", err))
		return "", err
	}
	fileName := entries[0].Name()

	binPath := path.Join(unzippedPath, fileName)
	return binPath, nil
}
