package util

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
)

func WriteJsonToFile[ObjectDef any](path string, object ObjectDef) error {
	bytesToWrite, err := json.Marshal(object)
	if err != nil {
		return newJsonFileIoError(err)
	}

	// Make sure dir exists
	dir := filepath.Dir(path)
	err = os.MkdirAll(dir, 0770)
	if err != nil {
		return newJsonFileIoError(err)
	}

	err = os.WriteFile(path, bytesToWrite, 0770)
	if err != nil {
		return newJsonFileIoError(err)
	}
	return nil
}

func LoadJsonFromFile[ObjectDef any](path string, object ObjectDef) error {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return newJsonFileIoError(err)
	}

	err = json.Unmarshal(bytes, object)
	if err != nil {
		return newJsonFileIoError(err)
	}

	return nil
}

func newJsonFileIoError(err error) error {
	return fmt.Errorf("json file io: %w", err)
}

type RemoveFileParams struct {
	LogCtx context.Context
	Path   string
}

func RemoveFile(params RemoveFileParams) error {
	ctx := params.LogCtx
	if ctx == nil {
		ctx = context.Background()
	}
	downloadPath := params.Path
	slog.InfoContext(ctx, "removing file from "+downloadPath)
	err := os.RemoveAll(downloadPath)
	if err != nil {
		return err
	}
	return nil
}
