package app

import (
	"mqtt-viewer/backend/models"
	"testing"
	"time"
)

func TestAddAndGetSysMetricMappings(t *testing.T) {
	app := getSeededTestApp(t)

	added, err := app.AddSysMetricMapping(1, models.SysMetricMapping{
		MetricKey:   "",
		Label:       "Heap used",
		Topic:       "$SYS/broker/heap/current",
		PayloadPath: "",
		Unit:        "B",
		SortOrder:   2,
	})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if added.ID == 0 {
		t.Error("Expected added mapping to be assigned an id")
	}
	if added.ConnectionID != 1 {
		t.Errorf("Expected connection id 1, got %v", added.ConnectionID)
	}

	mappings, err := app.GetSysMetricMappingsByConnectionId(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(mappings) != 1 {
		t.Fatalf("Expected 1 mapping, got %v", len(mappings))
	}
	if mappings[0].Topic != "$SYS/broker/heap/current" {
		t.Errorf("Expected topic round-trip, got %v", mappings[0].Topic)
	}
}

func TestGetSysMetricMappingsAreScopedToConnectionAndSorted(t *testing.T) {
	app := getSeededTestApp(t)

	if _, err := app.AddSysMetricMapping(1, models.SysMetricMapping{Label: "Second", SortOrder: 5}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, err := app.AddSysMetricMapping(1, models.SysMetricMapping{Label: "First", SortOrder: 1}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if _, err := app.AddSysMetricMapping(2, models.SysMetricMapping{Label: "Other connection"}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	mappings, err := app.GetSysMetricMappingsByConnectionId(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(mappings) != 2 {
		t.Fatalf("Expected 2 mappings for connection 1, got %v", len(mappings))
	}
	if mappings[0].Label != "First" || mappings[1].Label != "Second" {
		t.Errorf("Expected mappings sorted by sort order, got %v then %v", mappings[0].Label, mappings[1].Label)
	}
}

func TestUpdateSysMetricMapping(t *testing.T) {
	app := getSeededTestApp(t)

	added, err := app.AddSysMetricMapping(1, models.SysMetricMapping{
		Label: "Uptime",
		Topic: "$SYS/broker/uptime",
		Unit:  "s",
	})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	added.Topic = "$SYS/broker/version"
	// Cleared field must persist too (regression guard for zero-value updates).
	added.Unit = ""
	if _, err := app.UpdateSysMetricMapping(1, *added); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	mappings, err := app.GetSysMetricMappingsByConnectionId(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(mappings) != 1 {
		t.Fatalf("Expected 1 mapping, got %v", len(mappings))
	}
	if mappings[0].Topic != "$SYS/broker/version" {
		t.Errorf("Expected updated topic, got %v", mappings[0].Topic)
	}
	if mappings[0].Unit != "" {
		t.Errorf("Expected cleared unit to persist, got %q", mappings[0].Unit)
	}
}

func TestUpdateSysMetricMappingPreservesCreatedAt(t *testing.T) {
	app := getSeededTestApp(t)

	added, err := app.AddSysMetricMapping(1, models.SysMetricMapping{Label: "Uptime"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	originalCreatedAt := added.CreatedAt
	if originalCreatedAt.IsZero() {
		t.Fatal("Expected a non-zero created_at on the added mapping")
	}

	// Simulate the binding sending a zero createdAt on edit: an edit must never
	// overwrite the stored created_at.
	added.CreatedAt = time.Time{}
	added.Label = "Uptime (renamed)"
	if _, err := app.UpdateSysMetricMapping(1, *added); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	mappings, err := app.GetSysMetricMappingsByConnectionId(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(mappings) != 1 {
		t.Fatalf("Expected 1 mapping, got %v", len(mappings))
	}
	if !mappings[0].CreatedAt.Equal(originalCreatedAt) {
		t.Errorf("Expected created_at preserved (%v), got %v", originalCreatedAt, mappings[0].CreatedAt)
	}
	if mappings[0].Label != "Uptime (renamed)" {
		t.Errorf("Expected updated label, got %v", mappings[0].Label)
	}
}

func TestUpdateSysMetricMappingRejectsCrossConnection(t *testing.T) {
	app := getSeededTestApp(t)

	added, err := app.AddSysMetricMapping(1, models.SysMetricMapping{Label: "Owned by 1"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Connection 2 attempts to edit connection 1's mapping by id.
	added.Label = "Hijacked"
	if _, err := app.UpdateSysMetricMapping(2, *added); err == nil {
		t.Fatal("Expected cross-connection update to be rejected, got nil error")
	}

	// The original row must be untouched.
	mappings, err := app.GetSysMetricMappingsByConnectionId(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(mappings) != 1 || mappings[0].Label != "Owned by 1" {
		t.Errorf("Expected connection 1's mapping unchanged, got %+v", mappings)
	}
}

func TestDeleteSysMetricMapping(t *testing.T) {
	app := getSeededTestApp(t)

	added, err := app.AddSysMetricMapping(1, models.SysMetricMapping{Label: "Doomed"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if err := app.DeleteSysMetricMapping(1, added.ID); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	mappings, err := app.GetSysMetricMappingsByConnectionId(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(mappings) != 0 {
		t.Errorf("Expected 0 mappings after delete, got %v", len(mappings))
	}
}

func TestDeleteSysMetricMappingRejectsCrossConnection(t *testing.T) {
	app := getSeededTestApp(t)

	added, err := app.AddSysMetricMapping(1, models.SysMetricMapping{Label: "Owned by 1"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Connection 2 attempts to delete connection 1's mapping by id: must not
	// remove the row.
	if err := app.DeleteSysMetricMapping(2, added.ID); err != nil {
		t.Fatalf("Expected no error (delete is a no-op across connections), got %v", err)
	}

	mappings, err := app.GetSysMetricMappingsByConnectionId(1)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(mappings) != 1 {
		t.Errorf("Expected connection 1's mapping to survive a cross-connection delete, got %v", len(mappings))
	}
}

func TestDeletingConnectionCascadesSysMetricMappings(t *testing.T) {
	app := getSeededTestApp(t)

	if _, err := app.AddSysMetricMapping(1, models.SysMetricMapping{Label: "Cascade me"}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	// Delete the row directly rather than via app.DeleteConnection, which
	// emits a Wails event and needs a running app; the cascade is a DB-level
	// guarantee either way. Other child tables use NO ACTION FKs (cleared
	// explicitly by DeleteConnection), so clear them first here too.
	if res := app.Db.Where("connection_id = ?", 1).Delete(&models.Subscription{}); res.Error != nil {
		t.Fatalf("Expected no error, got %v", res.Error)
	}
	if res := app.Db.Where("connection_id = ?", 1).Delete(&models.Tab{}); res.Error != nil {
		t.Fatalf("Expected no error, got %v", res.Error)
	}
	if res := app.Db.Delete(&models.Connection{}, 1); res.Error != nil {
		t.Fatalf("Expected no error, got %v", res.Error)
	}

	var count int64
	if err := app.Db.Model(&models.SysMetricMapping{}).Where("connection_id = ?", 1).Count(&count).Error; err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if count != 0 {
		t.Errorf("Expected mappings to cascade-delete with the connection, got %v rows", count)
	}
}
