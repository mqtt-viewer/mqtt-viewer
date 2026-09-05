package app

import (
	"errors"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/events"

	"gorm.io/gorm"
)

// PinnedTopicsChangedPayload is the payload emitted on PinnedTopicsChanged so
// every window (main and any topic pop-outs) converges on the same pin list,
// since each webview holds its own copy of the store.
type PinnedTopicsChangedPayload struct {
	ConnectionID uint `json:"connectionId"`
}

// GetPinnedTopics returns a connection's pinned topics in pin order.
func (a *App) GetPinnedTopics(connectionID uint) ([]models.PinnedTopic, error) {
	pinned := []models.PinnedTopic{}
	if err := a.Db.
		Where("connection_id = ?", connectionID).
		Order("position asc, id asc").
		Find(&pinned).Error; err != nil {
		return nil, err
	}
	return pinned, nil
}

// PinTopic appends a topic to a connection's pin list. Pinning an
// already-pinned topic is a no-op, so it keeps its original position.
func (a *App) PinTopic(connectionID uint, topic string) error {
	err := a.Db.Transaction(func(tx *gorm.DB) error {
		var existing models.PinnedTopic
		err := tx.Where("connection_id = ? AND topic = ?", connectionID, topic).
			First(&existing).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		position, err := nextPinnedTopicPosition(tx, connectionID)
		if err != nil {
			return err
		}
		return tx.Create(&models.PinnedTopic{
			ConnectionID: connectionID,
			Topic:        topic,
			Position:     position,
		}).Error
	})
	if err != nil {
		return err
	}
	a.emitPinnedTopicsChanged(connectionID)
	return nil
}

// UnpinTopic removes one topic from a connection's pin list. Unpinning a topic
// that is not pinned is a no-op. Positions of the remaining pins are left
// alone; only their relative order matters.
func (a *App) UnpinTopic(connectionID uint, topic string) error {
	if err := a.Db.
		Where("connection_id = ? AND topic = ?", connectionID, topic).
		Delete(&models.PinnedTopic{}).Error; err != nil {
		return err
	}
	a.emitPinnedTopicsChanged(connectionID)
	return nil
}

// UnpinAllTopics clears a connection's pin list.
func (a *App) UnpinAllTopics(connectionID uint) error {
	if err := deletePinnedTopicsForConnection(&a.Db.DB, connectionID); err != nil {
		return err
	}
	a.emitPinnedTopicsChanged(connectionID)
	return nil
}

// nextPinnedTopicPosition returns the position that appends to the end of a
// connection's pin list, 0 when nothing is pinned yet.
func nextPinnedTopicPosition(tx *gorm.DB, connectionID uint) (int, error) {
	var highest *int
	if err := tx.Model(&models.PinnedTopic{}).
		Where("connection_id = ?", connectionID).
		Select("MAX(position)").Scan(&highest).Error; err != nil {
		return 0, err
	}
	if highest == nil {
		return 0, nil
	}
	return *highest + 1, nil
}

// deletePinnedTopicsForConnection clears one connection's pins. Shared with
// DeleteConnection so the rows go with the connection.
func deletePinnedTopicsForConnection(tx *gorm.DB, connectionID uint) error {
	return tx.Where("connection_id = ?", connectionID).
		Delete(&models.PinnedTopic{}).Error
}

// emitPinnedTopicsChanged tells every window to reload a connection's pins.
// EventRuntime is only wired up when running under the real Wails app (see
// Startup); guard so mutations are safely callable from unit tests too.
func (a *App) emitPinnedTopicsChanged(connectionID uint) {
	if a.EventRuntime == nil {
		return
	}
	a.EventRuntime.EventsEmit(string(events.PinnedTopicsChanged), PinnedTopicsChangedPayload{
		ConnectionID: connectionID,
	})
}
