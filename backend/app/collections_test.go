package app

import (
	"mqtt-viewer/backend/models"
	"strings"
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

func TestSaveCollectionMessageRejectsUnknownCollection(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	createTestCollections(t, app, connID)

	_, err := app.SaveCollectionMessage(SaveCollectionMessageParams{
		CollectionID: 99999,
		Name:         "Orphan",
		Topic:        "orphan/1",
	})
	if err == nil {
		t.Fatal("expected error saving into nonexistent collection")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected not found error, got %v", err)
	}

	var count int64
	app.Db.Model(&models.CollectionMessage{}).Count(&count)
	if count != 0 {
		t.Errorf("expected no message rows, got %d", count)
	}
}

func TestMoveCollectionMessageRejectsUnknownCollection(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	_, scoped := createTestCollections(t, app, connID)

	msg, err := app.SaveCollectionMessage(SaveCollectionMessageParams{
		CollectionID: scoped.ID,
		Name:         "Stays put",
		Topic:        "stay/1",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	_, err = app.MoveCollectionMessage(msg.ID, 99999)
	if err == nil {
		t.Fatal("expected error moving to nonexistent collection")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected not found error, got %v", err)
	}

	var stored models.CollectionMessage
	if err := app.Db.First(&stored, msg.ID).Error; err != nil {
		t.Fatalf("expected message to still exist, got %v", err)
	}
	if stored.CollectionID != scoped.ID {
		t.Errorf("expected message to stay in collection %d, got %d", scoped.ID, stored.CollectionID)
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

func TestSetCollectionCollapsedCreatesAndUpdates(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	global, _ := createTestCollections(t, app, connID)

	if err := app.SetCollectionCollapsed(global.ID, true); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	states, err := app.GetCollectionCollapsedStates()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(states) != 1 || states[0].ID != global.ID || !states[0].Collapsed {
		t.Fatalf("expected one collapsed state for %d, got %+v", global.ID, states)
	}

	if err := app.SetCollectionCollapsed(global.ID, false); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	var count int64
	app.Db.Model(&models.CollectionCollapsedState{}).Where("id = ?", global.ID).Count(&count)
	if count != 1 {
		t.Errorf("expected exactly 1 state row for %d, got %d", global.ID, count)
	}
	var state models.CollectionCollapsedState
	if err := app.Db.First(&state, global.ID).Error; err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if state.Collapsed {
		t.Errorf("expected state updated to expanded, got %+v", state)
	}
}

func TestDeleteCollectionRemovesCollapsedState(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	_, scoped := createTestCollections(t, app, connID)

	if err := app.SetCollectionCollapsed(scoped.ID, true); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if err := app.DeleteCollection(scoped.ID); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	states, err := app.GetCollectionCollapsedStates()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	for _, state := range states {
		if state.ID == scoped.ID {
			t.Errorf("expected collapsed state for %d deleted, got %+v", scoped.ID, states)
		}
	}
}

func TestDeleteConnectionCollectionsRemovesCollapsedStates(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	global, scoped := createTestCollections(t, app, connID)

	if err := app.SetCollectionCollapsed(global.ID, true); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if err := app.SetCollectionCollapsed(scoped.ID, true); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	// DeleteConnection itself emits runtime events unavailable in tests, so
	// exercise the collections cleanup helper it calls.
	if err := deleteCollectionsForConnection(&app.Db.DB, connID); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	var scopedCount, globalCount int64
	app.Db.Model(&models.CollectionCollapsedState{}).Where("id = ?", scoped.ID).Count(&scopedCount)
	app.Db.Model(&models.CollectionCollapsedState{}).Where("id = ?", global.ID).Count(&globalCount)
	if scopedCount != 0 {
		t.Errorf("expected scoped collection's collapsed state deleted, got %d", scopedCount)
	}
	if globalCount != 1 {
		t.Errorf("expected global collection's collapsed state kept, got %d", globalCount)
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

// idsEqual compares two id orders element by element.
func idsEqual(a []uint, b []uint) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// globalOrder is the read-back order of the global collections only, so the
// connection-scoped ones in the same result do not muddle the assertion.
func globalOrder(collections []models.Collection) []uint {
	ids := []uint{}
	for _, collection := range collections {
		if collection.ConnectionID == nil {
			ids = append(ids, collection.ID)
		}
	}
	return ids
}

func findCollection(t *testing.T, collections []models.Collection, id uint) models.Collection {
	t.Helper()
	for _, collection := range collections {
		if collection.ID == id {
			return collection
		}
	}
	t.Fatalf("expected collection %d in %+v", id, collections)
	return models.Collection{}
}

func messageOrder(collection models.Collection) []uint {
	ids := []uint{}
	for _, message := range collection.Messages {
		ids = append(ids, message.ID)
	}
	return ids
}

func saveTestMessage(t *testing.T, app *App, collectionID uint, name string) models.CollectionMessage {
	t.Helper()
	message, err := app.SaveCollectionMessage(SaveCollectionMessageParams{
		CollectionID: collectionID,
		Name:         name,
		Topic:        "test/" + name,
	})
	if err != nil {
		t.Fatalf("saving message %s: %v", name, err)
	}
	return message
}

func createTestCollection(t *testing.T, app *App, name string) models.Collection {
	t.Helper()
	collection, err := app.CreateCollection(CreateCollectionParams{Name: name})
	if err != nil {
		t.Fatalf("creating collection %s: %v", name, err)
	}
	return collection
}

func TestGetCollectionsForConnectionOrdersByPosition(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	first := createTestCollection(t, app, "First")
	second := createTestCollection(t, app, "Second")
	third := createTestCollection(t, app, "Third")

	msgA := saveTestMessage(t, app, first.ID, "a")
	msgB := saveTestMessage(t, app, first.ID, "b")
	msgC := saveTestMessage(t, app, first.ID, "c")

	// second is not listed, so it is renumbered after the two that are
	if err := app.ReorderCollections(nil, []uint{third.ID, first.ID}); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// msgB is not listed, so it is renumbered after the two that are
	if _, err := app.ReorderCollectionMessages(first.ID, []uint{msgC.ID, msgA.ID}); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{third.ID, first.ID, second.ID}
	if got := globalOrder(collections); !idsEqual(got, want) {
		t.Errorf("expected collection order %v, got %v", want, got)
	}
	wantMessages := []uint{msgC.ID, msgA.ID, msgB.ID}
	if got := messageOrder(findCollection(t, collections, first.ID)); !idsEqual(got, wantMessages) {
		t.Errorf("expected message order %v, got %v", wantMessages, got)
	}
}

func TestSaveCollectionMessageAppendsAtEnd(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	_, scoped := createTestCollections(t, app, connID)

	for i, name := range []string{"one", "two", "three"} {
		message := saveTestMessage(t, app, scoped.ID, name)
		if message.Position != i {
			t.Errorf("expected %s at position %d, got %d", name, i, message.Position)
		}
		var stored models.CollectionMessage
		if err := app.Db.First(&stored, message.ID).Error; err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if stored.Position != i {
			t.Errorf("expected stored %s at position %d, got %d", name, i, stored.Position)
		}
	}
}

func TestReorderCollectionMessagesPersists(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	collection := createTestCollection(t, app, "Ordered")

	first := saveTestMessage(t, app, collection.ID, "first")
	second := saveTestMessage(t, app, collection.ID, "second")
	third := saveTestMessage(t, app, collection.ID, "third")

	want := []uint{third.ID, first.ID, second.ID}
	reordered, err := app.ReorderCollectionMessages(collection.ID, want)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	got := []uint{}
	for _, message := range reordered {
		got = append(got, message.ID)
	}
	if !idsEqual(got, want) {
		t.Errorf("expected returned order %v, got %v", want, got)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got := messageOrder(findCollection(t, collections, collection.ID)); !idsEqual(got, want) {
		t.Errorf("expected persisted order %v, got %v", want, got)
	}
}

func TestReorderCollectionMessagesMovesAcrossCollections(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	source := createTestCollection(t, app, "Source")
	target := createTestCollection(t, app, "Target")

	moving := saveTestMessage(t, app, source.ID, "moving")
	staying := saveTestMessage(t, app, source.ID, "staying")
	head := saveTestMessage(t, app, target.ID, "head")
	tail := saveTestMessage(t, app, target.ID, "tail")

	if _, err := app.ReorderCollectionMessages(target.ID, []uint{head.ID, moving.ID, tail.ID}); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	wantTarget := []uint{head.ID, moving.ID, tail.ID}
	if got := messageOrder(findCollection(t, collections, target.ID)); !idsEqual(got, wantTarget) {
		t.Errorf("expected target order %v, got %v", wantTarget, got)
	}
	wantSource := []uint{staying.ID}
	if got := messageOrder(findCollection(t, collections, source.ID)); !idsEqual(got, wantSource) {
		t.Errorf("expected source order %v, got %v", wantSource, got)
	}

	var stored models.CollectionMessage
	if err := app.Db.First(&stored, moving.ID).Error; err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if stored.CollectionID != target.ID || stored.Position != 1 {
		t.Errorf("expected moved message in collection %d at position 1, got %d/%d", target.ID, stored.CollectionID, stored.Position)
	}
}

func TestReorderCollectionMessagesRejectsUnknownMessage(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	collection := createTestCollection(t, app, "Ordered")

	first := saveTestMessage(t, app, collection.ID, "first")
	second := saveTestMessage(t, app, collection.ID, "second")
	third := saveTestMessage(t, app, collection.ID, "third")

	_, err := app.ReorderCollectionMessages(collection.ID, []uint{third.ID, 99999, first.ID})
	if err == nil {
		t.Fatal("expected error reordering with a nonexistent message")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected not found error, got %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{first.ID, second.ID, third.ID}
	if got := messageOrder(findCollection(t, collections, collection.ID)); !idsEqual(got, want) {
		t.Errorf("expected rollback to leave order %v, got %v", want, got)
	}
}

func TestReorderCollectionsPersists(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	first := createTestCollection(t, app, "First")
	second := createTestCollection(t, app, "Second")
	third := createTestCollection(t, app, "Third")

	want := []uint{third.ID, first.ID, second.ID}
	if err := app.ReorderCollections(nil, want); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got := globalOrder(collections); !idsEqual(got, want) {
		t.Errorf("expected persisted order %v, got %v", want, got)
	}
}

func TestReorderCollectionsRejectsWrongScope(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	global, scoped := createTestCollections(t, app, connID)
	otherGlobal := createTestCollection(t, app, "Other global")

	established := []uint{otherGlobal.ID, global.ID}
	if err := app.ReorderCollections(nil, established); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	err := app.ReorderCollections(nil, []uint{global.ID, scoped.ID})
	if err == nil {
		t.Fatal("expected error reordering a connection-scoped collection into the global scope")
	}
	if !strings.Contains(err.Error(), "not in this scope") {
		t.Errorf("expected scope error, got %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got := globalOrder(collections); !idsEqual(got, established) {
		t.Errorf("expected rollback to leave order %v, got %v", established, got)
	}
	var stored models.Collection
	if err := app.Db.First(&stored, scoped.ID).Error; err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if stored.ConnectionID == nil || *stored.ConnectionID != connID {
		t.Errorf("expected scoped collection to stay on connection %d, got %+v", connID, stored.ConnectionID)
	}
}

func TestMoveCollectionMessageAppendsAtEnd(t *testing.T) {
	app, _ := getTestAppWithConnection(t)
	source := createTestCollection(t, app, "Source")
	target := createTestCollection(t, app, "Target")

	saveTestMessage(t, app, target.ID, "head")
	saveTestMessage(t, app, target.ID, "tail")
	moving := saveTestMessage(t, app, source.ID, "moving")

	moved, err := app.MoveCollectionMessage(moving.ID, target.ID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if moved.CollectionID != target.ID {
		t.Errorf("expected message in collection %d, got %d", target.ID, moved.CollectionID)
	}
	if moved.Position != 2 {
		t.Errorf("expected message appended at position 2, got %d", moved.Position)
	}
}

func TestDuplicateCollectionMessagePlacesCopyAfterOriginal(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	collection := createTestCollection(t, app, "Ordered")

	first := saveTestMessage(t, app, collection.ID, "first")
	second := saveTestMessage(t, app, collection.ID, "second")
	third := saveTestMessage(t, app, collection.ID, "third")

	copied, err := app.DuplicateCollectionMessage(first.ID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if copied.Position != first.Position+1 {
		t.Errorf("expected copy at position %d, got %d", first.Position+1, copied.Position)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{first.ID, copied.ID, second.ID, third.ID}
	if got := messageOrder(findCollection(t, collections, collection.ID)); !idsEqual(got, want) {
		t.Errorf("expected order %v, got %v", want, got)
	}
}

// connectionOrder is the read-back order of the collections scoped to a
// connection, so the global ones in the same result do not muddle the
// assertion.
func connectionOrder(collections []models.Collection) []uint {
	ids := []uint{}
	for _, collection := range collections {
		if collection.ConnectionID != nil {
			ids = append(ids, collection.ID)
		}
	}
	return ids
}

func collectionPosition(t *testing.T, app *App, id uint) int {
	t.Helper()
	var stored models.Collection
	if err := app.Db.First(&stored, id).Error; err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	return stored.Position
}

func messagePosition(t *testing.T, app *App, id uint) int {
	t.Helper()
	var stored models.CollectionMessage
	if err := app.Db.First(&stored, id).Error; err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	return stored.Position
}

func TestCreateCollectionAppendsAtEndOfItsScope(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	globalOne := createTestCollection(t, app, "Global one")
	globalTwo := createTestCollection(t, app, "Global two")

	if err := app.ReorderCollections(nil, []uint{globalTwo.ID, globalOne.ID}); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	globalThree := createTestCollection(t, app, "Global three")
	if globalThree.Position != 2 {
		t.Errorf("expected the new collection at position 2, got %d", globalThree.Position)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{globalTwo.ID, globalOne.ID, globalThree.ID}
	if got := globalOrder(collections); !idsEqual(got, want) {
		t.Errorf("expected global order %v, got %v", want, got)
	}
	if got := connectionOrder(collections); len(got) != 0 {
		t.Errorf("expected no connection-scoped collections, got %v", got)
	}
}

func TestCreateCollectionAppendsWithinAConnectionScope(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	createTestCollection(t, app, "Global")

	scopedOne, err := app.CreateCollection(CreateCollectionParams{Name: "Scoped one", ConnectionID: uintPtr(connID)})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	// A connection scope counts from 0 of its own, ignoring the global list.
	if scopedOne.Position != 0 {
		t.Errorf("expected the first scoped collection at position 0, got %d", scopedOne.Position)
	}
	scopedTwo, err := app.CreateCollection(CreateCollectionParams{Name: "Scoped two", ConnectionID: uintPtr(connID)})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if scopedTwo.Position != 1 {
		t.Errorf("expected the second scoped collection at position 1, got %d", scopedTwo.Position)
	}

	if err := app.ReorderCollections(uintPtr(connID), []uint{scopedTwo.ID, scopedOne.ID}); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	scopedThree, err := app.CreateCollection(CreateCollectionParams{Name: "Scoped three", ConnectionID: uintPtr(connID)})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{scopedTwo.ID, scopedOne.ID, scopedThree.ID}
	if got := connectionOrder(collections); !idsEqual(got, want) {
		t.Errorf("expected scoped order %v, got %v", want, got)
	}
}

func TestReorderCollectionMessagesRenumbersUnlistedMessages(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	collection := createTestCollection(t, app, "Ordered")

	a := saveTestMessage(t, app, collection.ID, "a")
	b := saveTestMessage(t, app, collection.ID, "b")
	c := saveTestMessage(t, app, collection.ID, "c")

	if _, err := app.ReorderCollectionMessages(collection.ID, []uint{c.ID, a.ID}); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	wantPositions := map[uint]int{c.ID: 0, a.ID: 1, b.ID: 2}
	for id, want := range wantPositions {
		if got := messagePosition(t, app, id); got != want {
			t.Errorf("expected message %d at position %d, got %d", id, want, got)
		}
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{c.ID, a.ID, b.ID}
	if got := messageOrder(findCollection(t, collections, collection.ID)); !idsEqual(got, want) {
		t.Errorf("expected order %v, got %v", want, got)
	}
}

func TestReorderCollectionsRenumbersUnlistedCollections(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	one := createTestCollection(t, app, "One")
	two := createTestCollection(t, app, "Two")
	three := createTestCollection(t, app, "Three")

	if err := app.ReorderCollections(nil, []uint{three.ID, one.ID}); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	wantPositions := map[uint]int{three.ID: 0, one.ID: 1, two.ID: 2}
	for id, want := range wantPositions {
		if got := collectionPosition(t, app, id); got != want {
			t.Errorf("expected collection %d at position %d, got %d", id, want, got)
		}
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{three.ID, one.ID, two.ID}
	if got := globalOrder(collections); !idsEqual(got, want) {
		t.Errorf("expected order %v, got %v", want, got)
	}
}

func TestReorderCollectionMessagesRejectsDuplicateIDs(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	collection := createTestCollection(t, app, "Ordered")

	a := saveTestMessage(t, app, collection.ID, "a")
	b := saveTestMessage(t, app, collection.ID, "b")

	_, err := app.ReorderCollectionMessages(collection.ID, []uint{a.ID, a.ID, b.ID})
	if err == nil {
		t.Fatal("expected error reordering with a duplicate message id")
	}
	if !strings.Contains(err.Error(), "duplicate id") {
		t.Errorf("expected duplicate id error, got %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{a.ID, b.ID}
	if got := messageOrder(findCollection(t, collections, collection.ID)); !idsEqual(got, want) {
		t.Errorf("expected order %v to be untouched, got %v", want, got)
	}
}

func TestReorderCollectionsRejectsDuplicateIDs(t *testing.T) {
	app, connID := getTestAppWithConnection(t)
	one := createTestCollection(t, app, "One")
	two := createTestCollection(t, app, "Two")

	err := app.ReorderCollections(nil, []uint{one.ID, one.ID, two.ID})
	if err == nil {
		t.Fatal("expected error reordering with a duplicate collection id")
	}
	if !strings.Contains(err.Error(), "duplicate id") {
		t.Errorf("expected duplicate id error, got %v", err)
	}

	collections, err := app.GetCollectionsForConnection(connID)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	want := []uint{one.ID, two.ID}
	if got := globalOrder(collections); !idsEqual(got, want) {
		t.Errorf("expected order %v to be untouched, got %v", want, got)
	}
}
