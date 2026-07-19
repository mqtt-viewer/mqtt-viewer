package app

import (
	"mqtt-viewer/backend/models"
	topicmatching "mqtt-viewer/backend/topic-matching"
	"os"
	"testing"
)

func TestAddAndGetProtoBindingRules(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	added, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{
		TopicFilter: "sensors/+/telemetry",
		MessageType: "demo.SensorPayload",
	})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if added.ID == 0 {
		t.Error("Expected added rule to be assigned an id")
	}
	if added.ConnectionID != connId {
		t.Errorf("Expected connection id %v, got %v", connId, added.ConnectionID)
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("Expected 1 rule, got %v", len(rules))
	}
	if rules[0].TopicFilter != "sensors/+/telemetry" {
		t.Errorf("Expected topic filter round-trip, got %v", rules[0].TopicFilter)
	}
}

func TestAddProtoBindingRuleAssignsIncrementingSortOrder(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	first, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	second, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "c/d", MessageType: "TypeB"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if second.SortOrder <= first.SortOrder {
		t.Errorf("Expected second rule to sort after the first, got %v then %v", first.SortOrder, second.SortOrder)
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 2 || rules[0].ID != first.ID || rules[1].ID != second.ID {
		t.Errorf("Expected rules ordered by sort_order, got %+v", rules)
	}
}

func TestAddProtoBindingRuleRejectsInvalidFilter(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	_, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "a/#/b", MessageType: "TypeA"})
	if err == nil {
		t.Fatal("Expected an error for a filter with '#' not in the last segment")
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 0 {
		t.Errorf("Expected no rule to be created for a rejected filter, got %v", len(rules))
	}
}

func TestUpdateProtoBindingRule(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	added, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	added.TopicFilter = "a/b/c"
	added.MessageType = "TypeB"
	if _, err := app.UpdateProtoBindingRule(connId, *added); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("Expected 1 rule, got %v", len(rules))
	}
	if rules[0].TopicFilter != "a/b/c" || rules[0].MessageType != "TypeB" {
		t.Errorf("Expected updated fields to persist, got %+v", rules[0])
	}
}

func TestUpdateProtoBindingRuleRejectsInvalidFilter(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	added, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	added.TopicFilter = "$share/group/a/b"
	if _, err := app.UpdateProtoBindingRule(connId, *added); err == nil {
		t.Fatal("Expected an error for a shared-subscription filter")
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if rules[0].TopicFilter != "a/b" {
		t.Errorf("Expected the original filter to survive a rejected update, got %v", rules[0].TopicFilter)
	}
}

func TestUpdateProtoBindingRuleRejectsCrossConnection(t *testing.T) {
	app, connA := getTestAppWithConnection(t)
	connBConn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating second connection: %v", err)
	}
	connB := connBConn.ConnectionDetails.ID

	added, err := app.AddProtoBindingRule(connA, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	added.MessageType = "Hijacked"
	if _, err := app.UpdateProtoBindingRule(connB, *added); err == nil {
		t.Fatal("Expected cross-connection update to be rejected, got nil error")
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connA)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 1 || rules[0].MessageType != "TypeA" {
		t.Errorf("Expected connection A's rule unchanged, got %+v", rules)
	}
}

// TestUpdateProtoBindingRuleIgnoresStaleSortOrder guards against a client
// sending back a rule it fetched before a reorder happened elsewhere: the
// stale SortOrder on that payload must not clobber the reorder that already
// landed in the DB.
func TestUpdateProtoBindingRuleIgnoresStaleSortOrder(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	first, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	second, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "c/d", MessageType: "TypeB"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Reverse the order, same as a drag-to-reorder in the UI.
	if err := app.ReorderProtoBindingRules(connId, []uint{second.ID, first.ID}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// A client still holding the pre-reorder `first` row edits its filter and
	// sends the whole row back, including the now-stale SortOrder of 0.
	staleEdit := *first
	staleEdit.TopicFilter = "a/b/c"
	if _, err := app.UpdateProtoBindingRule(connId, staleEdit); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 2 || rules[0].ID != second.ID || rules[1].ID != first.ID {
		t.Errorf("Expected the reorder to survive the stale-SortOrder update, got %+v", rules)
	}
	if rules[1].TopicFilter != "a/b/c" {
		t.Errorf("Expected the filter edit to still apply, got %v", rules[1].TopicFilter)
	}
}

func TestDeleteProtoBindingRule(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	added, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if err := app.DeleteProtoBindingRule(connId, added.ID); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 0 {
		t.Errorf("Expected 0 rules after delete, got %v", len(rules))
	}
}

func TestDeleteProtoBindingRuleRejectsCrossConnection(t *testing.T) {
	app, connA := getTestAppWithConnection(t)
	connBConn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating second connection: %v", err)
	}
	connB := connBConn.ConnectionDetails.ID

	added, err := app.AddProtoBindingRule(connA, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Connection B attempts to delete connection A's rule by id: must not
	// remove the row (delete is a no-op across connections).
	if err := app.DeleteProtoBindingRule(connB, added.ID); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connA)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 1 {
		t.Errorf("Expected connection A's rule to survive a cross-connection delete, got %v", len(rules))
	}
}

func TestReorderProtoBindingRules(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	first, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	second, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "c/d", MessageType: "TypeB"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Reverse the order.
	if err := app.ReorderProtoBindingRules(connId, []uint{second.ID, first.ID}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	rules, err := app.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(rules) != 2 || rules[0].ID != second.ID || rules[1].ID != first.ID {
		t.Errorf("Expected reversed order, got %+v", rules)
	}
}

func TestReorderProtoBindingRulesIgnoresUnownedIds(t *testing.T) {
	app, connA := getTestAppWithConnection(t)
	connBConn, err := app.NewConnection()
	if err != nil {
		t.Fatalf("creating second connection: %v", err)
	}
	connB := connBConn.ConnectionDetails.ID

	ownedByA, err := app.AddProtoBindingRule(connA, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	ownedByB, err := app.AddProtoBindingRule(connB, models.ProtoBindingRule{TopicFilter: "c/d", MessageType: "TypeB"})
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// connA reorders including an id it doesn't own; that id must be ignored.
	if err := app.ReorderProtoBindingRules(connA, []uint{ownedByA.ID, ownedByB.ID}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	rulesB, err := app.GetProtoBindingRulesByConnectionId(connB)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if rulesB[0].SortOrder != 0 {
		t.Errorf("Expected connection B's rule sort order untouched by connection A's reorder, got %v", rulesB[0].SortOrder)
	}
}

func TestDeletingConnectionCascadesProtoBindingRules(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "a/b", MessageType: "TypeA"}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	// Delete the row directly rather than via app.DeleteConnection, which
	// emits a Wails event and needs a running app; the cascade is a DB-level
	// guarantee either way. Other child tables use NO ACTION FKs (cleared
	// explicitly by DeleteConnection), so clear them first here too.
	if res := app.Db.Where("connection_id = ?", connId).Delete(&models.Subscription{}); res.Error != nil {
		t.Fatalf("Expected no error, got %v", res.Error)
	}
	if res := app.Db.Where("connection_id = ?", connId).Delete(&models.Tab{}); res.Error != nil {
		t.Fatalf("Expected no error, got %v", res.Error)
	}
	if res := app.Db.Delete(&models.Connection{}, connId); res.Error != nil {
		t.Fatalf("Expected no error, got %v", res.Error)
	}

	var count int64
	if err := app.Db.Model(&models.ProtoBindingRule{}).Where("connection_id = ?", connId).Count(&count).Error; err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if count != 0 {
		t.Errorf("Expected rules to cascade-delete with the connection, got %v rows", count)
	}
}

func TestGetProtoStateOnFreshConnection(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	state, err := app.GetProtoState(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.Dir != "" {
		t.Errorf("Expected no dir loaded yet, got %v", state.Dir)
	}
	if state.LoadError != "" {
		t.Errorf("Expected no load error, got %v", state.LoadError)
	}
	if state.HasImport {
		t.Error("Expected HasImport to be false when nothing has ever been imported")
	}
	if len(state.DescriptorNames) != 0 {
		t.Errorf("Expected no descriptor names, got %v", state.DescriptorNames)
	}
	if len(state.FileDescriptors) != 0 {
		t.Errorf("Expected no file descriptors, got %v", state.FileDescriptors)
	}
	if len(state.Rules) != 0 {
		t.Errorf("Expected no rules, got %v", state.Rules)
	}
}

// TestGetProtoStateHasImportReflectsDiskBeforeCompile is the regression case
// for the "not imported" flash: right after a restart, protoState hasn't
// compiled anything yet (Dir is still empty), but HasImport is a plain
// os.Stat of the internal proto-imports dir, so it already reflects reality
// before the lazy compile (ConnectMqtt or the ProtoSection mount's
// LoadProtoRegistry call) has had a chance to run.
func TestGetProtoStateHasImportReflectsDiskBeforeCompile(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	// Simulate a fresh app session: nothing compiled into protoState yet
	// (same as right after a restart, before ConnectMqtt or
	// LoadProtoRegistry has run), but the import is still on disk.
	app.AppConnections[connId].ProtoState.Clear()

	state, err := app.GetProtoState(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if !state.HasImport {
		t.Error("Expected HasImport to reflect the on-disk import even before it's been compiled this session")
	}
	if state.Dir != "" {
		t.Errorf("Expected Dir to stay empty until a compile actually runs, got %v", state.Dir)
	}
}

func TestGetProtoStateUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.GetProtoState(999); err == nil {
		t.Fatal("Expected an error for an unknown connection id")
	}
}

// TestLoadProtoRegistryOnFreshConnectionStaysEmpty covers the "nothing
// imported yet" path: LoadProtoRegistry compiles the internal proto-imports
// dir, which doesn't exist until an import happens, so it must come back
// empty rather than surfacing a "folder not found" error (that error is
// reserved for an internal dir that existed and then vanished; see
// proto_import_test.go).
func TestLoadProtoRegistryOnFreshConnectionStaysEmpty(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	state, err := app.LoadProtoRegistry(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.LoadError != "" {
		t.Errorf("Expected no load error, got %v", state.LoadError)
	}
	if state.DirMissing {
		t.Error("Expected DirMissing to be false when nothing has been imported")
	}
	if len(state.DescriptorNames) != 0 {
		t.Errorf("Expected no descriptor names, got %v", state.DescriptorNames)
	}
}

// TestLoadProtoRegistrySkipsRecompileWhenAlreadyLoaded guards the needs-load
// gate: once a session has already compiled the connection's internal
// import dir successfully, a second LoadProtoRegistry call (the ProtoSection
// mount path, called on every dialog open) must not recompile. Proven here
// by mutating the internal dir directly (bypassing the app's import APIs)
// and checking a second call still serves the cached registry rather than
// noticing the dir is now empty.
func TestLoadProtoRegistrySkipsRecompileWhenAlreadyLoaded(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.ImportProtoDir(connId, testProtosGoodDir); err != nil {
		t.Fatalf("importing: %v", err)
	}

	if err := os.RemoveAll(app.protoImportDir(connId)); err != nil {
		t.Fatalf("removing internal import dir: %v", err)
	}

	state, err := app.LoadProtoRegistry(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if len(state.DescriptorNames) == 0 {
		t.Error("Expected LoadProtoRegistry to skip the recompile and keep serving the already-loaded registry")
	}
	if state.DirMissing {
		t.Error("Expected DirMissing to reflect the last successful compile, not a skipped recompile against the now-removed dir")
	}
}

func TestLoadProtoRegistryUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.LoadProtoRegistry(999); err == nil {
		t.Fatal("Expected an error for an unknown connection id")
	}
}

func TestGetMatchingProtoTypeForTopicWithRule(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	if _, err := app.AddProtoBindingRule(connId, models.ProtoBindingRule{TopicFilter: "sensors/+/telemetry", MessageType: "demo.SensorPayload"}); err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	match, err := app.GetMatchingProtoTypeForTopic(connId, "sensors/room1/telemetry")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if match.Source != topicmatching.SourceRule || match.MessageType != "demo.SensorPayload" {
		t.Errorf("Expected a rule match, got %+v", match)
	}
}

func TestGetMatchingProtoTypeForTopicSparkplugFallback(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	match, err := app.GetMatchingProtoTypeForTopic(connId, "spBv1.0/group1/NDATA/node1")
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if match.Source != topicmatching.SourceSparkplug || match.MessageType != "SparkplugBPayload" {
		t.Errorf("Expected the implicit sparkplug fallback, got %+v", match)
	}
}

func TestGetMatchingProtoTypeForTopicUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.GetMatchingProtoTypeForTopic(999, "a/b"); err == nil {
		t.Fatal("Expected an error for an unknown connection id")
	}
}
