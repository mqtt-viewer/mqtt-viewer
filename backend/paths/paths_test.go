package paths

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetPathsUsesDataDirOverride(t *testing.T) {
	// The override points at a subdir that does not exist yet, so we also check
	// GetPaths creates it (the containerised data volume mount point).
	dataDir := filepath.Join(t.TempDir(), "data")
	t.Setenv("MQTT_VIEWER_DATA_DIR", dataDir)

	p := GetPaths()

	if p.ResourcePath != dataDir {
		t.Errorf("expected ResourcePath %q, got %q", dataDir, p.ResourcePath)
	}
	if _, err := os.Stat(dataDir); err != nil {
		t.Errorf("expected override dir to be created, got: %v", err)
	}
}

func TestGetPathsIgnoresEmptyDataDirOverride(t *testing.T) {
	// An empty override must fall through to the per-OS default rather than
	// using "" as the resource path.
	t.Setenv("MQTT_VIEWER_DATA_DIR", "")

	p := GetPaths()

	if p.ResourcePath == "" {
		t.Error("expected a non-empty per-OS resource path when override is empty")
	}
}
