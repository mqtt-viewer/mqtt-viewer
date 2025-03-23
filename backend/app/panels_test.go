package app

import (
	"mqtt-viewer/backend/models"
	"testing"
)

func TestUpdatePanelSizeCreatesRecordWhenNoneExists(t *testing.T) {
	app := getSeededTestApp(t)

	err := app.UpdatePanelSize("test", 100, true)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	var panelSize models.PanelSize
	err = app.Db.First(&panelSize, "id = ?", "test").Error
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if panelSize.Size != 100 {
		t.Errorf("Expected panel size to be 100, got %v", panelSize.Size)
	}
}

func TestUpdatePanelSizeUpdatesRecordWhenOneExists(t *testing.T) {
	app := getSeededTestApp(t)

	err := app.UpdatePanelSize("test", 100, true)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	err = app.UpdatePanelSize("test", 200, true)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	var panelSize models.PanelSize
	err = app.Db.First(&panelSize, "id = ?", "test").Error
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if panelSize.Size != 200 {
		t.Errorf("Expected panel size to be 200, got %v", panelSize.Size)
	}
}
