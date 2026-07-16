package app

import (
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
	// Save (not Updates) so the editor can clear optional fields back to "":
	// struct Updates skips zero values and would silently keep the old text.
	if res := a.Db.Save(&mapping); res.Error != nil {
		return nil, res.Error
	}
	return &mapping, nil
}

func (a *App) DeleteSysMetricMapping(connId uint, id uint) error {
	if res := a.Db.Delete(&models.SysMetricMapping{}, id); res.Error != nil {
		return res.Error
	}
	return nil
}
