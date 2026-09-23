package app

import (
	"mqtt-viewer/backend/models"

	"gorm.io/gorm"
)

func (a *App) LoadOpenTabs() ([]models.Tab, error) {
	var tabs []models.Tab
	err := a.Db.Order("tab_index").Find(&tabs).Error
	if err != nil {
		return nil, err
	}
	return tabs, nil
}

func (a *App) UpdateOpenConnectionTabs(connIds []uint) error {
	err := a.Db.Transaction(func(tx *gorm.DB) error {
		tx.Exec("DELETE from tabs")
		for i, connId := range connIds {
			err := tx.Create(&models.Tab{TabIndex: uint(i + 1), ConnectionID: connId}).Error
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	// A topic pop-out only makes sense while its connection's tab is open:
	// every tab close funnels through here with the remaining open list, so
	// close pop-outs for anything no longer in it. Silent close - the dock
	// mode must not revert when a tab takes its pop-out with it.
	closeTopicWindowsNotIn(connIds)
	return nil
}
