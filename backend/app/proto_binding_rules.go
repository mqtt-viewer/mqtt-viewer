package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"
	"os"
	"sort"

	"gorm.io/gorm"
)

// compileProtoRegistry wraps protobuf.LoadProtoRegistry with an explicit
// missing-directory check: filepath.WalkDir over a nonexistent path yields
// no files rather than an error, which would otherwise render identically
// to a valid-but-empty folder in the UI. Always safe to call outside any
// lock; it only touches the filesystem and does no App/protoState state.
func compileProtoRegistry(dir string) (*protobuf.ProtoRegistry, string, bool) {
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return nil, "folder not found", true
	}
	registry, err := protobuf.LoadProtoRegistry(dir)
	if err != nil {
		return nil, err.Error(), false
	}
	return registry, "", false
}

// ProtoStateResult is the read model the frontend polls (on dialog open,
// after a dir pick, and on ProtoStateChanged) to render the bindings form
// and publish panel. Dir/LoadError/FileDescriptors/DescriptorNames describe
// the compiled per-connection registry (all zero values until one loads
// successfully); Rules is always the live DB row set.
type ProtoStateResult struct {
	Dir             string                    `json:"dir"`
	LoadError       string                    `json:"loadError"`
	DirMissing      bool                      `json:"dirMissing"`
	FileDescriptors map[string][]string       `json:"fileDescriptors"`
	DescriptorNames []string                  `json:"descriptorNames"`
	Rules           []models.ProtoBindingRule `json:"rules"`
}

func (a *App) GetProtoBindingRulesByConnectionId(connId uint) ([]models.ProtoBindingRule, error) {
	rules := []models.ProtoBindingRule{}
	if res := a.Db.Where("connection_id = ?", connId).Order("sort_order, id").Find(&rules); res.Error != nil {
		return nil, res.Error
	}
	return rules, nil
}

// AddProtoBindingRule takes the full row (unlike AddSubscription) so the
// frontend can supply the topic filter and type in one call. SortOrder is
// forced to one past the connection's current max, regardless of anything
// the caller supplied.
func (a *App) AddProtoBindingRule(connId uint, rule models.ProtoBindingRule) (*models.ProtoBindingRule, error) {
	if _, ok := a.AppConnections[connId]; !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	if err := topicmatching.ValidateTopicFilter(rule.TopicFilter); err != nil {
		return nil, err
	}

	existing, err := a.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		return nil, err
	}
	sortOrder := 0
	for _, r := range existing {
		if r.SortOrder >= sortOrder {
			sortOrder = r.SortOrder + 1
		}
	}

	rule.ID = 0
	rule.ConnectionID = connId
	rule.SortOrder = sortOrder
	if res := a.Db.Create(&rule); res.Error != nil {
		return nil, res.Error
	}

	if err := a.refreshProtoBindingRulesAndEmit(connId); err != nil {
		return nil, err
	}
	return &rule, nil
}

// UpdateProtoBindingRule verifies the row exists and belongs to connId before
// writing (a caller can't edit another connection's rule by supplying its
// id), then writes the user-mutable columns explicitly with Select so a
// cleared value persists and created_at/connection_id are left untouched.
func (a *App) UpdateProtoBindingRule(connId uint, rule models.ProtoBindingRule) (*models.ProtoBindingRule, error) {
	if _, ok := a.AppConnections[connId]; !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	if err := topicmatching.ValidateTopicFilter(rule.TopicFilter); err != nil {
		return nil, err
	}

	existingRule := models.ProtoBindingRule{}
	if res := a.Db.First(&existingRule, rule.ID); res.Error != nil {
		return nil, res.Error
	}
	if existingRule.ConnectionID != connId {
		return nil, fmt.Errorf("proto binding rule %d does not belong to connection %d", rule.ID, connId)
	}

	existingRule.TopicFilter = rule.TopicFilter
	existingRule.MessageType = rule.MessageType
	existingRule.SortOrder = rule.SortOrder
	if res := a.Db.Model(&existingRule).
		Select("TopicFilter", "MessageType", "SortOrder").
		Updates(&existingRule); res.Error != nil {
		return nil, res.Error
	}

	if err := a.refreshProtoBindingRulesAndEmit(connId); err != nil {
		return nil, err
	}
	return &existingRule, nil
}

// DeleteProtoBindingRule scopes by both id and connection_id so a connection
// can only delete its own rules; deleting an id owned by another connection
// is a silent no-op (SysMetricMapping precedent).
func (a *App) DeleteProtoBindingRule(connId uint, id uint) error {
	if res := a.Db.Where("connection_id = ?", connId).Delete(&models.ProtoBindingRule{}, id); res.Error != nil {
		return res.Error
	}
	return a.refreshProtoBindingRulesAndEmit(connId)
}

// ReorderProtoBindingRules sets SortOrder from orderedIds' position. Ids not
// owned by connId simply match zero rows and are silently ignored.
func (a *App) ReorderProtoBindingRules(connId uint, orderedIds []uint) error {
	if _, ok := a.AppConnections[connId]; !ok {
		return fmt.Errorf("connection not found (%d)", connId)
	}

	err := a.Db.Transaction(func(tx *gorm.DB) error {
		for i, id := range orderedIds {
			if res := tx.Model(&models.ProtoBindingRule{}).
				Where("id = ? AND connection_id = ?", id, connId).
				Update("sort_order", i); res.Error != nil {
				return res.Error
			}
		}
		return nil
	})
	if err != nil {
		return err
	}

	return a.refreshProtoBindingRulesAndEmit(connId)
}

// LoadProtoRegistry explicitly (re)compiles the connection's configured
// ProtoRegDir and swaps the result into its live protoState. Used on
// directory pick, manual reload, and when the details form opens on a dir
// that's set but never compiled. Compile failure is reported in the returned
// ProtoStateResult.LoadError rather than as a hard error, so the UI can
// render it; a hard error is returned only when the connection itself is
// unknown.
func (a *App) LoadProtoRegistry(connId uint) (*ProtoStateResult, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}

	connection := models.Connection{}
	if res := a.Db.First(&connection, connId); res.Error != nil {
		return nil, res.Error
	}

	dir := ""
	if connection.ProtoRegDir != nil {
		dir = *connection.ProtoRegDir
	}

	if dir == "" {
		appConnection.ProtoState.Clear()
		a.emitProtoStateChanged(connId)
		return a.buildProtoStateResult(connId, appConnection)
	}

	// Compile outside protoState's lock: this walks the filesystem and
	// parses every .proto file, which can be slow.
	registry, loadErr, dirMissing := compileProtoRegistry(dir)
	appConnection.ProtoState.SetRegistry(registry, dir, loadErr, dirMissing)
	a.emitProtoStateChanged(connId)

	return a.buildProtoStateResult(connId, appConnection)
}

// GetProtoState is the cheap, no-compile read used for event-driven
// refetches: it reads whatever is already in memory (plus rules from the
// DB) rather than recompiling.
func (a *App) GetProtoState(connId uint) (*ProtoStateResult, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return nil, fmt.Errorf("connection not found (%d)", connId)
	}
	return a.buildProtoStateResult(connId, appConnection)
}

// GetMatchingProtoTypeForTopic resolves topic via MatchUncached so one-off
// lookups (the publish panel, the bindings form's topic tester) never evict
// the decode hot path's cache.
func (a *App) GetMatchingProtoTypeForTopic(connId uint, topic string) (topicmatching.ProtoBindingMatch, error) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return topicmatching.ProtoBindingMatch{}, fmt.Errorf("connection not found (%d)", connId)
	}
	return appConnection.ProtoState.MatchUncached(topic), nil
}

func (a *App) buildProtoStateResult(connId uint, appConnection *AppConnection) (*ProtoStateResult, error) {
	rules, err := a.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		return nil, err
	}

	snapshot := appConnection.ProtoState.snapshot()
	result := &ProtoStateResult{
		Dir:             snapshot.loadedDir,
		LoadError:       snapshot.loadError,
		DirMissing:      snapshot.dirMissing,
		FileDescriptors: map[string][]string{},
		DescriptorNames: []string{},
		Rules:           rules,
	}

	if snapshot.registry != nil {
		if snapshot.registry.LoadedFilesWithDescriptorsMap != nil {
			result.FileDescriptors = *snapshot.registry.LoadedFilesWithDescriptorsMap
		}
		names := snapshot.registry.GetLoadedDescriptorNames()
		sort.Strings(names)
		result.DescriptorNames = names
	}

	return result, nil
}

// refreshProtoBindingRulesAndEmit re-reads a connection's rules from the DB,
// pushes them into the live matcher, and pings ProtoStateChanged so open
// windows refetch via the cheap GetProtoState. A no-op if the AppConnection
// doesn't exist (shouldn't happen in practice, but keeps this safe to call
// mid-delete).
func (a *App) refreshProtoBindingRulesAndEmit(connId uint) error {
	rules, err := a.GetProtoBindingRulesByConnectionId(connId)
	if err != nil {
		return err
	}
	if appConnection, ok := a.AppConnections[connId]; ok {
		appConnection.ProtoState.SetRules(rules)
	}
	a.emitProtoStateChanged(connId)
	return nil
}

// emitProtoStateChanged pings every window for connId to refetch proto state.
// Safe to call for a connection with no AppConnection (silent no-op) and
// guarded like every other per-connection emit against test mode, where
// EventRuntime is never initialised.
func (a *App) emitProtoStateChanged(connId uint) {
	appConnection, ok := a.AppConnections[connId]
	if !ok {
		return
	}
	if a.Mode != AppModes.Test {
		a.EventRuntime.EventsEmit(appConnection.EventSet.ProtoStateChanged, nil)
	}
}
