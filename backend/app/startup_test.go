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

func getTestApp(t *testing.T) *App {
	app := NewApp(AppModes.Test, "0.0.0-test")
	ctx := context.Background()
	exPath := filepath.Join(appDir, "_test", t.Name())
	// Create this path if it does not exist
	if _, err := os.Stat(exPath); err == nil {
		os.RemoveAll(exPath)
		// Clean any old test dbs
	}
	if _, err := os.Stat(exPath); os.IsNotExist(err) {
		os.MkdirAll(exPath, os.ModePerm)
	}

	t.Cleanup(func() {
		os.RemoveAll(exPath)
	})

	app.Startup(ctx, &StartupOptions{
		PathsOverride: &paths.Paths{
			ResourcePath: exPath,
		},
	})
	return app
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

	DB, err := app.Db.DB.DB()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	DB.Close()
	// Use the newly seeded DB on start
	app = getTestApp(t)

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
		if conn.Connection.ID != uint(id) {
			t.Errorf("Expected connection id %v, got %v", id+1, conn.Connection.ID)
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

	if appConn.Connection.ID != connModel.ID {
		t.Errorf("Expected connection id %v, got %v", connModel.ID, appConn.Connection.ID)
	}
}
