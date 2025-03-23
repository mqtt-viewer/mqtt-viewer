package util

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
)

type DownloadFileParams struct {
	LogCtx context.Context
	Url    string
	Dest   string
}

func DownloadFile(params DownloadFileParams) error {
	url := params.Url
	dest := params.Dest
	ctx := params.LogCtx
	if ctx == nil {
		ctx = context.Background()
	}
	slog.InfoContext(ctx, fmt.Sprintf("downloading %s to %s", url, dest))
	// create the directory if it doesn't exist
	err := os.MkdirAll(filepath.Dir(dest), os.ModePerm)
	if err != nil {
		return err
	}
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return err
	}
	slog.InfoContext(ctx, "download successful")
	return nil
}
