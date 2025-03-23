package util

import (
	"os"
	"path"
	"runtime"
	"testing"
)

var _, filename, _, _ = runtime.Caller(0)
var dir = path.Dir(filename)
var testDir = path.Join(dir, "_test")

func TestDownloadFile(t *testing.T) {
	fileUrl := "https://raw.githubusercontent.com/hackhunterdev/oui/refs/heads/main/version.txt"
	filePath := path.Join(testDir, t.Name(), "test.txt")

	t.Cleanup(func() {
		_ = os.RemoveAll(path.Dir(filePath))
	})

	err := DownloadFile(DownloadFileParams{
		Url:  fileUrl,
		Dest: filePath,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	_, err = os.Stat(filePath)
	if err != nil {
		t.Fatalf("expected file to exist, got %v", err)
	}

}
