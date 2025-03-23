package app

import (
	"mqtt-viewer/backend/models"
	"testing"
)

func assertTabsAreCorrect(t *testing.T, tabs []models.Tab, expectedIds []uint) {
	if len(tabs) != len(expectedIds) {
		t.Errorf("Expected %v tabs, got %v", len(expectedIds), len(tabs))
	}

	for i, tab := range tabs {
		if tab.ConnectionID != expectedIds[i] {
			t.Errorf("Expected tab %v to have connection id %v, got %v", i, expectedIds[i], tab.ConnectionID)
		}
	}
}

func TestTabsAreCreatedWhenNoneExist(t *testing.T) {
	app := getSeededTestApp(t)

	err := app.UpdateOpenConnectionTabs([]uint{1, 2, 3})
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	var tabs []models.Tab
	err = app.Db.Find(&tabs).Error
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	assertTabsAreCorrect(t, tabs, []uint{1, 2, 3})
}

func TestTabsAreUpdatedWhenSomeExist(t *testing.T) {
	app := getSeededTestApp(t)

	err := app.UpdateOpenConnectionTabs([]uint{1, 2, 3})
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	err = app.UpdateOpenConnectionTabs([]uint{3, 2, 1})

	var tabs []models.Tab
	err = app.Db.Find(&tabs).Error
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	assertTabsAreCorrect(t, tabs, []uint{3, 2, 1})
}

func TestTabsAreLoadedCorrectly(t *testing.T) {
	app := getSeededTestApp(t)

	err := app.UpdateOpenConnectionTabs([]uint{1, 2, 3, 4, 5})
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	tabs, err := app.LoadOpenTabs()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	assertTabsAreCorrect(t, tabs, []uint{1, 2, 3, 4, 5})
}
