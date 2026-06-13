package app

import (
	"mqtt-viewer/backend/models"
	"testing"
)

func uintPtr(v uint) *uint {
	return &v
}

func getTestAppWithConnection(t *testing.T) (*App, uint) {
	app := getTestApp(t)
	conn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating connection: %v", err)
	}
	return app, conn.ConnectionDetails.ID
}

func createTestCollections(t *testing.T, app *App, connectionID uint) (models.Collection, models.Collection) {
	global, err := app.CreateCollection(CreateCollectionParams{Name: "Global one"})
	if err != nil {
		t.Fatalf("creating global collection: %v", err)
	}
	scoped, err := app.CreateCollection(CreateCollectionParams{Name: "Scoped one", ConnectionID: uintPtr(connectionID)})
	if err != nil {
		t.Fatalf("creating scoped collection: %v", err)
	}
	return global, scoped
}

func TestGetCollectionsForConnectionReturnsGlobalAndScoped(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	global, scoped := createTestCollections(t, app, connID)

	// a collection scoped to another connection must not be returned
	otherConn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating second connection: %v", err)
	}
	_, err = app.CreateCollection(CreateCollectionParams{Name: "Other conn", ConnectionID: uintPtr(otherConn.ConnectionDetails.ID)})
	if err != nil {
		t.Fatalf("creating other-connection collection: %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(collections) != 2 {
		t.Fatalf("expected 2 collections, got %d", len(collections))
	}
	ids := map[uint]bool{collections[0].ID: true, collections[1].ID: true}
	if !ids[global.ID] || !ids[scoped.ID] {
		t.Errorf("expected global %d and scoped %d, got %+v", global.ID, scoped.ID, collections)
	}
}

func TestSaveCollectionMessageCreatesAndUpdates(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	_, scoped := createTestCollections(t, app, connID)

	created, err := app.SaveCollectionMessage(SaveCollectionMessageParams{
		CollectionID: scoped.ID,
		Name:         "Backyard sensor",
		Topic:        "backyard/sensors/1",
		Payload:      `{"temp": 45}`,
		QoS:          1,
		Retain:       true,
		Encoding:     "none",
		Format:       "json",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if created.ID == 0 {
		t.Fatal("expected created message to have an ID")
	}

	updated, err := app.SaveCollectionMessage(SaveCollectionMessageParams{
		ID:           &created.ID,
		CollectionID: scoped.ID,
		Name:         "Backyard sensor",
		Topic:        "backyard/sensors/1",
		Payload:      `{"temp": 50}`,
		QoS:          0,
		Retain:       false,
		Encoding:     "none",
		Format:       "json",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if updated.ID != created.ID {
		t.Errorf("expected update to keep ID %d, got %d", created.ID, updated.ID)
	}
	if updated.Payload != `{"temp": 50}` {
		t.Errorf("expected updated payload, got %s", updated.Payload)
	}

	var count int64
	app.Db.Model(&models.CollectionMessage{}).Count(&count)
	if count != 1 {
		t.Errorf("expected 1 message row, got %d", count)
	}
}

func TestDeleteCollectionCascadesMessages(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	_, scoped := createTestCollections(t, app, connID)

	_, err := app.SaveCollectionMessage(SaveCollectionMessageParams{
		CollectionID: scoped.ID,
		Name:         "doomed",
		Topic:        "a/b",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if err := app.DeleteCollection(scoped.ID); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	var collCount, msgCount int64
	app.Db.Model(&models.Collection{}).Where("id = ?", scoped.ID).Count(&collCount)
	app.Db.Model(&models.CollectionMessage{}).Where("collection_id = ?", scoped.ID).Count(&msgCount)
	if collCount != 0 || msgCount != 0 {
		t.Errorf("expected collection and messages deleted, got %d collections %d messages", collCount, msgCount)
	}
}

func TestMoveAndDuplicateAndRenameCollectionMessage(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	global, scoped := createTestCollections(t, app, connID)

	msg, err := app.SaveCollectionMessage(SaveCollectionMessageParams{
		CollectionID: scoped.ID,
		Name:         "Kitchen sensor",
		Topic:        "kitchen/1",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	moved, err := app.MoveCollectionMessage(msg.ID, global.ID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if moved.CollectionID != global.ID {
		t.Errorf("expected message moved to %d, got %d", global.ID, moved.CollectionID)
	}

	if _, err := app.MoveCollectionMessage(msg.ID, 99999); err == nil {
		t.Error("expected error moving to nonexistent collection")
	}

	dup, err := app.DuplicateCollectionMessage(msg.ID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if dup.ID == msg.ID || dup.Name != "Kitchen sensor copy" || dup.CollectionID != global.ID {
		t.Errorf("unexpected duplicate: %+v", dup)
	}

	renamed, err := app.RenameCollectionMessage(dup.ID, "Pantry sensor")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if renamed.Name != "Pantry sensor" {
		t.Errorf("expected renamed message, got %s", renamed.Name)
	}
}

func TestDeleteConnectionRemovesScopedCollectionsOnly(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	global, scoped := createTestCollections(t, app, connID)

	_, err := app.SaveCollectionMessage(SaveCollectionMessageParams{CollectionID: scoped.ID, Name: "m", Topic: "t"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// DeleteConnection itself emits runtime events unavailable in tests, so
	// exercise the collections cleanup helper it calls.
	if err := deleteCollectionsForConnection(&app.Db.DB, connID); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	var scopedCount, msgCount, globalCount int64
	app.Db.Model(&models.Collection{}).Where("id = ?", scoped.ID).Count(&scopedCount)
	app.Db.Model(&models.CollectionMessage{}).Where("collection_id = ?", scoped.ID).Count(&msgCount)
	app.Db.Model(&models.Collection{}).Where("id = ?", global.ID).Count(&globalCount)
	if scopedCount != 0 || msgCount != 0 {
		t.Errorf("expected scoped collection and messages deleted, got %d/%d", scopedCount, msgCount)
	}
	if globalCount != 1 {
		t.Errorf("expected global collection kept, got %d", globalCount)
	}
}
