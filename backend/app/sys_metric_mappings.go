package app

import (
	"fmt"
	"mqtt-viewer/backend/models"
)

func (a *App) GetSysMetricMappingsByConnectionId(connId uint) ([]models.SysMetricMapping, error) {
	mappings := []models.SysMetricMapping{}
	if res := a.Db.Where("connection_id = ?", connId).Order("sort_order, id").Find(&mappings); res.Error != nil {
		return nil, res.Error
	}
	return mappings, nil
}

// AddSysMetricMapping takes the full row (unlike AddSubscription) so
// "pin as tile" from the raw $SYS browser creates a populated mapping in one
// call.
func (a *App) AddSysMetricMapping(connId uint, mapping models.SysMetricMapping) (*models.SysMetricMapping, error) {
	mapping.ID = 0
	mapping.ConnectionID = connId
	if res := a.Db.Create(&mapping); res.Error != nil {
		return nil, res.Error
	}
	return &mapping, nil
}

func (a *App) UpdateSysMetricMapping(connId uint, mapping models.SysMetricMapping) (*models.SysMetricMapping, error) {
	// Verify the row exists and belongs to this connection before writing, so a
	// caller can't edit another connection's mapping by supplying its id.
	existing := models.SysMetricMapping{}
	if res := a.Db.First(&existing, mapping.ID); res.Error != nil {
		return nil, res.Error
	}
	if existing.ConnectionID != connId {
		return nil, fmt.Errorf("sys metric mapping %d does not belong to connection %d", mapping.ID, connId)
	}

	// Copy only the user-mutable fields onto the fetched row, then write those
	// columns explicitly with Select. Selecting the fields makes GORM write them
	// even when zeroed (so clearing an optional field back to "" persists), while
	// created_at / connection_id are left untouched. A blanket Save would write a
	// zero CreatedAt (the binding sends a null createdAt) and clobber created_at
	// on every edit.
	existing.MetricKey = mapping.MetricKey
	existing.Label = mapping.Label
	existing.Topic = mapping.Topic
	existing.PayloadPath = mapping.PayloadPath
	existing.Unit = mapping.Unit
	existing.SortOrder = mapping.SortOrder
	if res := a.Db.Model(&existing).
		Select("MetricKey", "Label", "Topic", "PayloadPath", "Unit", "SortOrder").
		Updates(&existing); res.Error != nil {
		return nil, res.Error
	}
	return &existing, nil
}

func (a *App) DeleteSysMetricMapping(connId uint, id uint) error {
	// Scope by both id and connection_id so a connection can only delete its own
	// mappings.
	if res := a.Db.Where("connection_id = ?", connId).Delete(&models.SysMetricMapping{}, id); res.Error != nil {
		return res.Error
	}
	return nil
}
