package db

import (
	"mqtt-viewer/backend/models"
	"os"
	"path"
	"strings"
	"testing"
)

func TestMigrateIsIdempotent(t *testing.T) {
	testDb, err := NewDb(t.TempDir(), nil)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	defer closeDb(t, testDb)

	if err := testDb.Migrate(); err != nil {
		t.Fatalf("expected no error on first migrate, got %v", err)
	}
	if err := testDb.Migrate(); err != nil {
		t.Fatalf("expected no error on second migrate, got %v", err)
	}

	migrationFiles, err := migrationsDir.ReadDir("migrations")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	expectedCount := int64(0)
	for _, file := range migrationFiles {
		if strings.HasSuffix(file.Name(), ".sql") {
			expectedCount++
		}
	}

	var appliedCount int64
	if err := testDb.Model(&models.Migration{}).Count(&appliedCount).Error; err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if appliedCount != expectedCount {
		t.Errorf("expected %d applied migrations, got %d", expectedCount, appliedCount)
	}
}

func TestNewDbRemovesStaleSidecarFiles(t *testing.T) {
	dir := t.TempDir()
	journalPath := path.Join(dir, "MqttViewer.db-journal")
	if err := os.WriteFile(journalPath, []byte("stale journal"), 0644); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	testDb, err := NewDb(dir, nil)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	defer closeDb(t, testDb)

	if _, err := os.Stat(journalPath); !os.IsNotExist(err) {
		t.Errorf("expected stale journal file to be removed, stat err: %v", err)
	}
}

func closeDb(t *testing.T, testDb *DB) {
	sqlDb, err := testDb.DB.DB()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	sqlDb.Close()
}
