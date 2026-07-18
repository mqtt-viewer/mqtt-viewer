package app

import (
	"mqtt-viewer/backend/models"
	topicmatching "mqtt-viewer/backend/topic-matching"
	"path"
	"testing"
)

// setProtoRegDir sets a connection's ProtoRegDir via the same path the
// frontend uses (a partial UpdateConnection carrying the full row, as
// ConnectionForm sends), so LoadProtoRegistry has something to read.
func setProtoRegDir(t *testing.T, app *App, connId uint, dir string) {
	t.Helper()
	conn := models.Connection{}
	if res := app.Db.First(&conn, connId); res.Error != nil {
		t.Fatalf("fetching connection: %v", res.Error)
	}
	conn.ProtoRegDir = &dir
	if err := app.UpdateConnection(&conn); err != nil {
		t.Fatalf("setting proto reg dir: %v", err)
	}
}

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

func TestGetProtoStateUnknownConnection(t *testing.T) {
	app := getTestApp(t)

	if _, err := app.GetProtoState(999); err == nil {
		t.Fatal("Expected an error for an unknown connection id")
	}
}

func TestLoadProtoRegistrySuccess(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	dir := path.Join(appDir, "..", "protobuf", "test-protos", "test-protos-good")
	setProtoRegDir(t, app, connId, dir)

	state, err := app.LoadProtoRegistry(connId)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}
	if state.LoadError != "" {
		t.Errorf("Expected no load error, got %v", state.LoadError)
	}
	if len(state.DescriptorNames) == 0 {
		t.Error("Expected descriptor names to be populated")
	}
}

func TestLoadProtoRegistryBadDirSetsLoadErrorNotHardError(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	setProtoRegDir(t, app, connId, "/definitely/does/not/exist-abc123")

	state, err := app.LoadProtoRegistry(connId)
	if err != nil {
		t.Fatalf("Expected no hard error for a bad dir, got %v", err)
	}
	if state.LoadError == "" {
		t.Error("Expected a load error for a nonexistent dir")
	}
	if !state.DirMissing {
		t.Error("Expected DirMissing to be true for a nonexistent dir")
	}
}

func TestLoadProtoRegistryCompileErrorDoesNotSetDirMissing(t *testing.T) {
	app, connId := getTestAppWithConnection(t)

	dir := path.Join(appDir, "..", "protobuf", "test-protos", "test-protos-one-bad")
	setProtoRegDir(t, app, connId, dir)

	state, err := app.LoadProtoRegistry(connId)
	if err != nil {
		t.Fatalf("Expected no hard error for a compile failure, got %v", err)
	}
	if state.LoadError == "" {
		t.Error("Expected a load error for a directory with a bad proto file")
	}
	if state.DirMissing {
		t.Error("Expected DirMissing to be false when the dir exists but a proto file fails to compile")
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
