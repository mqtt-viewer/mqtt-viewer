package app

import (
	"context"
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/paths"
	"mqtt-viewer/backend/protobuf"
	"mqtt-viewer/events"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
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

func getTestApp(t *testing.T) *App {
	exPath := filepath.Join(appDir, "_test", t.Name())
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
func reopenTestApp(t *testing.T, app *App) *App {
	exPath := filepath.Join(appDir, "_test", t.Name())
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
	if len(app.AppConnections) != 5 {
		t.Errorf("Expected 5 connections, got %v", len(app.AppConnections))
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
	for id, conn := range app.AppConnections {
		if conn.ConnectionId != uint(id) {
			t.Errorf("Expected connection id %v, got %v", id+1, conn.ConnectionId)
		}
	}
}

// TestStartupSparkplugRegistryExcludesProtoImports guards against the global
// Sparkplug registry compile sweeping up connections' proto-imports/: it
// must be scoped to the sparkplug-only subdir of ResourcePath, or a bad or
// colliding user import would break Sparkplug decoding app-wide and user
// types would leak into the globally resolvable registry.
func TestStartupSparkplugRegistryExcludesProtoImports(t *testing.T) {
	app, connId := getTestAppWithConnection(t)
	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	// Simulate a fresh app launch with proto-imports/<connId>/ already
	// present on disk under ResourcePath: the scenario that would leak the
	// imported "demo.*" types into the global registry if Startup's compile
	// weren't scoped to the sparkplug-only subdir.
	app = reopenTestApp(t, app)

	var registry *protobuf.ProtoRegistry
	deadline := time.Now().Add(2 * time.Second)
	for registry == nil && time.Now().Before(deadline) {
		registry = app.ProtoRegistry.Load()
		if registry == nil {
			time.Sleep(10 * time.Millisecond)
		}
	}
	if registry == nil {
		t.Fatal("expected the global Sparkplug registry to load")
	}

	names := registry.GetLoadedDescriptorNames()
	if len(names) == 0 {
		t.Fatal("expected the global registry to contain the Sparkplug types")
	}
	for _, name := range names {
		if strings.HasPrefix(name, "demo.") {
			t.Errorf("expected the global registry to contain only Sparkplug types, got user import type %v", name)
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
