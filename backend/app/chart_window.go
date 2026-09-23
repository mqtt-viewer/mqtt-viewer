package app

import "mqtt-viewer/backend/models"

func (a *App) UpdateChartWindow(connId string, seconds int64) error {
	return a.Db.Save(&models.ChartWindow{ID: connId, WindowSeconds: seconds}).Error
}

func (a *App) GetChartWindows() ([]models.ChartWindow, error) {
	var rows []models.ChartWindow
	if res := a.Db.Find(&rows); res.Error != nil {
		return nil, res.Error
	}
	return rows, nil
}
