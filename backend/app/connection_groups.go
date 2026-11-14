package app

import (
	"errors"
	"fmt"
	"mqtt-viewer/backend/models"
	"strings"

	"gorm.io/gorm"
)

// GetConnectionGroups returns every Home-screen group, alphabetical ignoring
// case, id breaking a tie.
func (a *App) GetConnectionGroups() ([]models.ConnectionGroup, error) {
	groups := []models.ConnectionGroup{}
	if err := a.Db.Order("name COLLATE NOCASE asc, id asc").Find(&groups).Error; err != nil {
		return nil, err
	}
	return groups, nil
}

func cleanGroupName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("group name cannot be empty")
	}
	return name, nil
}

func (a *App) NewConnectionGroup(name string) (models.ConnectionGroup, error) {
	name, err := cleanGroupName(name)
	if err != nil {
		return models.ConnectionGroup{}, err
	}
	group := models.ConnectionGroup{Name: name}
	if err := a.Db.Create(&group).Error; err != nil {
		return models.ConnectionGroup{}, err
	}
	return group, nil
}

func (a *App) RenameConnectionGroup(id uint, name string) (models.ConnectionGroup, error) {
	name, err := cleanGroupName(name)
	if err != nil {
		return models.ConnectionGroup{}, err
	}
	var group models.ConnectionGroup
	if err := a.Db.First(&group, id).Error; err != nil {
		return models.ConnectionGroup{}, groupLookupError(err, id)
	}
	group.Name = name
	if err := a.Db.Save(&group).Error; err != nil {
		return models.ConnectionGroup{}, err
	}
	return group, nil
}

func (a *App) SetConnectionGroupCollapsed(id uint, collapsed bool) error {
	res := a.Db.Model(&models.ConnectionGroup{}).Where("id = ?", id).Update("collapsed", collapsed)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return fmt.Errorf("connection group %d not found", id)
	}
	return nil
}

// DeleteConnectionGroup ungroups the group's connections, then deletes it, so
// a connection is never lost with its group.
func (a *App) DeleteConnectionGroup(id uint) error {
	return a.Db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Connection{}).Where("group_id = ?", id).Update("group_id", nil).Error; err != nil {
			return err
		}
		return tx.Delete(&models.ConnectionGroup{}, id).Error
	})
}

// SetConnectionGroup moves a connection into a group, or out of every group
// when groupID is nil. It is the only writer of group_id: UpdateConnection
// skips nil fields, so it could never clear it.
func (a *App) SetConnectionGroup(connectionID uint, groupID *uint) error {
	if groupID != nil {
		var group models.ConnectionGroup
		if err := a.Db.First(&group, *groupID).Error; err != nil {
			return groupLookupError(err, *groupID)
		}
	}
	var conn models.Connection
	if err := a.Db.First(&conn, connectionID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("connection %d not found", connectionID)
		}
		return err
	}
	return a.Db.Model(&conn).Update("group_id", groupID).Error
}

func groupLookupError(err error, id uint) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("connection group %d not found", id)
	}
	return err
}
