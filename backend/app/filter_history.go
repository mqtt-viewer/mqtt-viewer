package app

import (
	"errors"
	"log/slog"
	"mqtt-viewer/backend/models"
	"time"

	"gorm.io/gorm"
)

func (a *App) GetFilterHistoriesForConnection(connectionID uint) ([]models.FilterHistory, error) {
	var filterHistories []models.FilterHistory
	if err := a.Db.
		Where("connection_id = ?", connectionID).
		Order("last_used desc").
		Limit(500).
		Find(&filterHistories).Error; err != nil {
		return nil, err
	}
	return filterHistories, nil
}

func (a *App) SaveFilterHistoryEntry(connectionId uint, text string) (models.FilterHistory, error) {
	existingEntry := models.FilterHistory{}
	err := a.Db.Where("connection_id = ? AND text = ?", connectionId, text).First(&existingEntry).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		filterHistory := models.FilterHistory{
			ConnectionID: connectionId,
			Text:         text,
			LastUsed:     time.Now(),
		}
		err := a.Db.Create(&filterHistory).Error
		if err != nil {
			slog.Error(err.Error())
			return models.FilterHistory{}, err
		}
		return filterHistory, nil
	} else if err != nil {
		slog.Error(err.Error())
		return models.FilterHistory{}, err
	}
	existingEntry.LastUsed = time.Now()
	err = a.Db.Save(&existingEntry).Error
	if err != nil {
		slog.Error(err.Error())
		return models.FilterHistory{}, err
	}
	return existingEntry, nil
}

func (a *App) DeleteFilterHistoryEntry(connectionId uint, text string) {
	err := a.Db.Where("connection_id = ? AND text = ?", connectionId, text).Delete(&models.FilterHistory{}).Error
	if err != nil {
		slog.Error(err.Error())
	}
}
