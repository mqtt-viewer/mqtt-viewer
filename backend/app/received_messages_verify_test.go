package app

import (
	"strings"
	"testing"
)

// queryPlan returns the joined EXPLAIN QUERY PLAN details for a query.
func queryPlan(app *App, query string, args ...any) (string, error) {
	rows, err := app.Db.Raw("EXPLAIN QUERY PLAN "+query, args...).Rows()
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var details []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			return "", err
		}
		details = append(details, detail)
	}
	return strings.Join(details, " | "), nil
}

func seedReceived(t *testing.T, app *App) uint {
	t.Helper()
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	enableRecording(t, app)
	insertReceived(app, conn.ConnectionDetails.ID, 5000, 64)
	return conn.ConnectionDetails.ID
}

// The newest/older window query must use the composite index, never a full scan.
func TestWindowQueryUsesIndex(t *testing.T) {
	app := getTestApp(t)
	connID := seedReceived(t, app)

	plan, err := queryPlan(app,
		"SELECT * FROM received_messages WHERE connection_id = ? AND topic = ? AND id < ? ORDER BY id DESC LIMIT ?",
		connID, "t/0", 999999, 5000)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	t.Logf("older-window plan: %s", plan)
	if !strings.Contains(plan, "received_messages_conn_topic_id") {
		t.Errorf("expected window query to use received_messages_conn_topic_id, plan: %s", plan)
	}
	if strings.Contains(plan, "SCAN received_messages") && !strings.Contains(plan, "USING") {
		t.Errorf("window query is doing a full table scan, plan: %s", plan)
	}
}

func TestForwardWindowQueryUsesIndex(t *testing.T) {
	app := getTestApp(t)
	connID := seedReceived(t, app)

	plan, err := queryPlan(app,
		"SELECT * FROM received_messages WHERE connection_id = ? AND topic = ? AND id > ? ORDER BY id ASC LIMIT ?",
		connID, "t/0", 0, 5000)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	t.Logf("newer-window plan: %s", plan)
	if !strings.Contains(plan, "received_messages_conn_topic_id") {
		t.Errorf("expected forward window query to use the composite index, plan: %s", plan)
	}
}

func TestCountQueryUsesIndex(t *testing.T) {
	app := getTestApp(t)
	connID := seedReceived(t, app)

	plan, err := queryPlan(app,
		"SELECT count(*) FROM received_messages WHERE connection_id = ? AND topic = ?",
		connID, "t/0")
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	t.Logf("count plan: %s", plan)
	if !strings.Contains(plan, "received_messages_conn_topic_id") &&
		!strings.Contains(plan, "received_messages_conn_id") {
		t.Errorf("expected count query to use an index, plan: %s", plan)
	}
}

func TestPragmasConfigured(t *testing.T) {
	app := getTestApp(t)

	var journalMode string
	if err := app.Db.Raw("PRAGMA journal_mode").Scan(&journalMode).Error; err != nil {
		t.Fatalf("journal_mode: %v", err)
	}
	if strings.ToLower(journalMode) != "wal" {
		t.Errorf("expected WAL journal mode, got %q", journalMode)
	}

	var autoVacuum int
	if err := app.Db.Raw("PRAGMA auto_vacuum").Scan(&autoVacuum).Error; err != nil {
		t.Fatalf("auto_vacuum: %v", err)
	}
	// 2 = INCREMENTAL. Fresh test DBs are created with it set before any table.
	if autoVacuum != 2 {
		t.Errorf("expected auto_vacuum INCREMENTAL (2) on a fresh db, got %d", autoVacuum)
	}

	var synchronous int
	if err := app.Db.Raw("PRAGMA synchronous").Scan(&synchronous).Error; err != nil {
		t.Fatalf("synchronous: %v", err)
	}
	// 1 = NORMAL
	if synchronous != 1 {
		t.Errorf("expected synchronous NORMAL (1), got %d", synchronous)
	}
}

func TestForeignKeysOn(t *testing.T) {
	app := getTestApp(t)
	var fk int
	if err := app.Db.Raw("PRAGMA foreign_keys").Scan(&fk).Error; err != nil {
		t.Fatalf("foreign_keys: %v", err)
	}
	if fk != 1 {
		t.Errorf("expected foreign_keys ON, got %d", fk)
	}
}
