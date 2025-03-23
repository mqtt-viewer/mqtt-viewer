package util

import (
	"context"
	"os"
	"path"
	"testing"
)

func TestUnzip(t *testing.T) {
	testZipFile := path.Join(testDir, "test.txt.zip")
	outDir := path.Join(testDir, t.Name())

	t.Cleanup(func() {
		_ = os.RemoveAll(outDir)
	})

	err := Unzip(context.Background(), testZipFile, outDir)
	if err != nil {
		t.Fatalf("Unzip() error = %v", err)
	}
}
