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

// stripSqlComments drops whole-line SQL comments so a statement's leading
// keyword is the first thing left of it.
func stripSqlComments(statement string) string {
	kept := []string{}
	for _, line := range strings.Split(statement, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

// readMigration returns the embedded migration whose name ends with the given
// suffix, so the generated timestamp prefix stays out of the test.
func readMigration(t *testing.T, suffix string) string {
	t.Helper()
	entries, err := migrationsDir.ReadDir("migrations")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), suffix) {
			continue
		}
		content, err := migrationsDir.ReadFile("migrations/" + entry.Name())
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		return string(content)
	}
	t.Fatalf("expected to find a migration ending in %s", suffix)
	return ""
}

func TestCollectionOrderingBackfill(t *testing.T) {
	testDb, err := NewDb(t.TempDir(), nil)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	defer closeDb(t, testDb)

	if err := testDb.Migrate(); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// Rows as they look before the backfill: every position still 0.
	seed := []string{
		"INSERT INTO connections (id, name) VALUES (1, 'seed')",
		"INSERT INTO collections (id, connection_id, name, position) VALUES (1, NULL, 'global one', 0)",
		"INSERT INTO collections (id, connection_id, name, position) VALUES (2, 1, 'scoped', 0)",
		"INSERT INTO collections (id, connection_id, name, position) VALUES (3, NULL, 'global two', 0)",
		"INSERT INTO collection_messages (id, collection_id, name, position) VALUES (1, 1, 'a', 0)",
		"INSERT INTO collection_messages (id, collection_id, name, position) VALUES (2, 1, 'b', 0)",
		"INSERT INTO collection_messages (id, collection_id, name, position) VALUES (3, 3, 'c', 0)",
		"INSERT INTO collection_messages (id, collection_id, name, position) VALUES (4, 1, 'd', 0)",
		"INSERT INTO collection_messages (id, collection_id, name, position) VALUES (5, 3, 'e', 0)",
	}
	for _, statement := range seed {
		if err := testDb.Exec(statement).Error; err != nil {
			t.Fatalf("seeding %q: %v", statement, err)
		}
	}

	backfilled := 0
	for _, statement := range strings.Split(readMigration(t, "collection-ordering.sql"), ";") {
		statement = stripSqlComments(statement)
		if !strings.HasPrefix(strings.ToUpper(statement), "UPDATE") {
			continue
		}
		if err := testDb.Exec(statement).Error; err != nil {
			t.Fatalf("running backfill %q: %v", statement, err)
		}
		backfilled++
	}
	if backfilled != 2 {
		t.Fatalf("expected 2 backfill statements, got %d", backfilled)
	}

	// ids 1, 2, 4 sit in collection 1; ids 3, 5 sit in collection 3
	wantMessagePositions := map[uint]int{1: 0, 2: 1, 4: 2, 3: 0, 5: 1}
	for id, want := range wantMessagePositions {
		var got int
		if err := testDb.Raw("SELECT position FROM collection_messages WHERE id = ?", id).Scan(&got).Error; err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if got != want {
			t.Errorf("expected message %d at position %d, got %d", id, want, got)
		}
	}

	// ids 1 and 3 are the global scope; id 2 is alone on connection 1
	wantCollectionPositions := map[uint]int{1: 0, 3: 1, 2: 0}
	for id, want := range wantCollectionPositions {
		var got int
		if err := testDb.Raw("SELECT position FROM collections WHERE id = ?", id).Scan(&got).Error; err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if got != want {
			t.Errorf("expected collection %d at position %d, got %d", id, want, got)
		}
	}
}
