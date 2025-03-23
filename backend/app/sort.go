package app

import "mqtt-viewer/backend/models"

func (a *App) UpdateSortState(sortId string, sortCriteria string, sortDirection string) error {
	return a.Db.Save(&models.SortState{ID: sortId, SortCriteria: sortCriteria, SortDirection: sortDirection}).Error
}

func (a *App) GetSortStates() ([]models.SortState, error) {
	var sortStates []models.SortState
	if res := a.Db.Find(&sortStates); res.Error != nil {
		return nil, res.Error
	}
	return sortStates, nil
}
