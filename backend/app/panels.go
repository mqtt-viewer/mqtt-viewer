package app

import (
	"mqtt-viewer/backend/models"
)

func (a *App) UpdatePanelSize(panelId string, size uint, isOpen bool) error {
	return a.Db.Save(&models.PanelSize{ID: panelId, Size: size, IsOpen: isOpen}).Error
}

func (a *App) GetPanelSizes() ([]models.PanelSize, error) {
	var panelSizes []models.PanelSize
	if res := a.Db.Find(&panelSizes); res.Error != nil {
		return nil, res.Error
	}
	return panelSizes, nil
}
