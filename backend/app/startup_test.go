package app

import (
	"context"
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/paths"
	"mqtt-viewer/events"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"testing"
)

var _, filename, _, _ = runtime.Caller(0)
var appDir = path.Dir(filename)

func startTestAppAt(exPath string) *App {
	app := NewApp(AppModes.Test, "0.0.0-test")
	ctx := context.Background()
	app.Startup(ctx, &StartupOptions{
		PathsOverride: &paths.Paths{
			ResourcePath: exPath,
		},
	})
	return app
}

// getTestApp starts an App against a resource dir of its own.
//
// The dir name carries the PID because it used to be just
// backend/app/_test/<TestName>, wiped with os.RemoveAll on entry. That path
// has no per-run component, so two `go test` processes running the same test
// deleted and recreated the directory underneath each other while SQLite had
// the database open, and the run died with "disk I/O error (1802)". Agents and
// worktrees share this machine and run the suite at the same time, so it hit
// often enough to look like a real failure.
//
// Not t.TempDir: Startup writes the sparkplug proto files from a goroutine
// that outlives the test, so it can still be creating files while the test
// framework tears the directory down. t.TempDir treats that as a cleanup
// error and fails the test; the RemoveAll below tolerates it, which is the
// behaviour this suite has always relied on.
//
// _test is gitignored scratch, so a directory orphaned by a killed run is
// harmless, and deleting the whole _test tree is always safe.
func getTestApp(t *testing.T) *App {
	exPath := filepath.Join(appDir, "_test", fmt.Sprintf("%s-%d", t.Name(), os.Getpid()))
	// Clean any old test db left over from a previous run before starting fresh.
	os.RemoveAll(exPath)
	os.MkdirAll(exPath, os.ModePerm)

	t.Cleanup(func() {
		os.RemoveAll(exPath)
	})

	return startTestAppAt(exPath)
}

// reopenTestApp closes the app's DB connection and starts a new App against
// the same on-disk resource dir, simulating an app restart that reloads
// whatever was persisted rather than wiping and recreating the DB.
//
// It reads the path back off the app rather than recomputing it, so there is
// only one place that decides where a test app lives.
func reopenTestApp(t *testing.T, app *App) *App {
	exPath := app.Paths.ResourcePath
	DB, err := app.Db.DB.DB()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	DB.Close()
	return startTestAppAt(exPath)
}

func getSeededTestApp(t *testing.T) *App {
	app := getTestApp(t)

	for i := 0; i < 5; i++ {
		port := 1883
		isProtoEnabled := false
		isCertsEnabled := false
		var qos uint = 0
		conn := models.Connection{
			Name:           fmt.Sprintf("Connection %d", i),
			Protocol:       "mqtt",
			Host:           "localhost",
			Port:           port,
			IsProtoEnabled: &isProtoEnabled,
			IsCertsEnabled: &isCertsEnabled,
			Subscriptions: []models.Subscription{
				{
					Topic: "#",
					QoS:   &qos,
				},
				{
					Topic: "$SYS/#",
					QoS:   &qos,
				},
			},
		}
		err := app.Db.Create(&conn).Error
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
	}

	// Reopen against the same on-disk DB so the app loads the seeded data.
	app = reopenTestApp(t, app)

	return app
}

func TestGetTestApp(t *testing.T) {
	app := getTestApp(t)
	if app == nil {
		t.Errorf("Expected app, got nil")
	}
}

func TestGetSeededTestApp(t *testing.T) {
	app := getSeededTestApp(t)
	if app == nil {
		t.Errorf("Expected app, got nil")
	}
	if app.appConnectionCount() != 5 {
		t.Errorf("Expected 5 connections, got %v", app.appConnectionCount())
	}
}

func TestGetSavedConnectionsReturnsAllConnections(t *testing.T) {
	app := getSeededTestApp(t)
	savedConnections, err := app.getSavedConnections()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if len(*savedConnections) != 5 {
		t.Errorf("Expected 5 connections, got %v", len(*savedConnections))
	}

}

func TestAppConnectionIdMapIsBuiltCorrectly(t *testing.T) {
	app := getSeededTestApp(t)
	for id, conn := range app.appConnectionsSnapshot() {
		if conn.ConnectionId != uint(id) {
			t.Errorf("Expected connection id %v, got %v", id+1, conn.ConnectionId)
		}
	}
}

func TestCreateAppConnectionFromConnectionModel(t *testing.T) {
	app := getTestApp(t)
	port := 1883
	isProtoEnabled := false
	isCertsEnabled := false
	connModel := models.Connection{
		ID:             1,
		Name:           "Test Connection",
		Protocol:       "mqtt",
		Host:           "localhost",
		Port:           port,
		IsProtoEnabled: &isProtoEnabled,
		IsCertsEnabled: &isCertsEnabled,
		Subscriptions:  []models.Subscription{},
	}
	connEventBuilder := events.NewConnectionEvents()

	appConn, err := app.createAppConnectionFromConnectionModel(&connModel, connEventBuilder)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	if appConn.ConnectionId != connModel.ID {
		t.Errorf("Expected connection id %v, got %v", connModel.ID, appConn.ConnectionId)
	}
}
