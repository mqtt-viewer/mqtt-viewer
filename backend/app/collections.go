package app

import (
	"errors"
	"fmt"
	"mqtt-viewer/backend/models"

	"gorm.io/gorm"
)

// GetCollectionsForConnection returns global collections (connection_id IS NULL)
// plus collections scoped to the given connection, messages preloaded. Both
// levels come back in their persisted order, id breaking a tie.
func (a *App) GetCollectionsForConnection(connectionID uint) ([]models.Collection, error) {
	var collections []models.Collection
	if err := a.Db.
		Where("connection_id = ? OR connection_id IS NULL", connectionID).
		Preload("Messages", func(db *gorm.DB) *gorm.DB {
			return db.Order("collection_messages.position asc, collection_messages.id asc")
		}).
		Order("position asc, id asc").
		Find(&collections).Error; err != nil {
		return nil, err
	}
	return collections, nil
}

type CreateCollectionParams struct {
	Name string `json:"name"`
	// nil = global collection
	ConnectionID *uint `json:"connectionId"`
}

func (a *App) CreateCollection(params CreateCollectionParams) (models.Collection, error) {
	position, err := nextCollectionPosition(&a.Db.DB, params.ConnectionID)
	if err != nil {
		return models.Collection{}, err
	}
	collection := models.Collection{
		Name:         params.Name,
		ConnectionID: params.ConnectionID,
		Position:     position,
		Messages:     []models.CollectionMessage{},
	}
	if err := a.Db.Create(&collection).Error; err != nil {
		return models.Collection{}, err
	}
	return collection, nil
}

// scopedCollections narrows a query to one collection scope: the global list
// when connectionID is nil, otherwise that connection's list.
func scopedCollections(tx *gorm.DB, connectionID *uint) *gorm.DB {
	if connectionID == nil {
		return tx.Where("connection_id IS NULL")
	}
	return tx.Where("connection_id = ?", *connectionID)
}

// nextCollectionPosition returns the position that appends to the end of a
// scope's folder list, 0 when the scope is empty.
func nextCollectionPosition(tx *gorm.DB, connectionID *uint) (int, error) {
	var highest *int
	query := scopedCollections(tx.Model(&models.Collection{}), connectionID)
	if err := query.Select("MAX(position)").Scan(&highest).Error; err != nil {
		return 0, err
	}
	if highest == nil {
		return 0, nil
	}
	return *highest + 1, nil
}

func (a *App) RenameCollection(id uint, name string) (models.Collection, error) {
	var collection models.Collection
	if err := a.Db.First(&collection, id).Error; err != nil {
		return models.Collection{}, err
	}
	collection.Name = name
	if err := a.Db.Save(&collection).Error; err != nil {
		return models.Collection{}, err
	}
	return collection, nil
}

// rejectDuplicateIDs guards a reorder against the same id appearing twice,
// which would otherwise leave the row at whichever position came last and the
// rest of the list one place out.
func rejectDuplicateIDs(ids []uint) error {
	seen := make(map[uint]struct{}, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			return fmt.Errorf("duplicate id %d", id)
		}
		seen[id] = struct{}{}
	}
	return nil
}

// ReorderCollections rewrites the order of one scope's collections: the global
// list when connectionID is nil, otherwise that connection's list. An id from
// another scope is rejected, which is what stops a folder being dragged between
// the global and connection sections. It never changes connection_id.
//
// orderedIDs does not have to be the whole scope. Anything left out keeps its
// relative order and follows the listed folders, so no two rows in a scope end
// up sharing a position.
func (a *App) ReorderCollections(connectionID *uint, orderedIDs []uint) error {
	if err := rejectDuplicateIDs(orderedIDs); err != nil {
		return err
	}
	return a.Db.Transaction(func(tx *gorm.DB) error {
		for i, id := range orderedIDs {
			var collection models.Collection
			if err := tx.First(&collection, id).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return fmt.Errorf("collection %d not found", id)
				}
				return err
			}
			if !sameCollectionScope(collection.ConnectionID, connectionID) {
				return fmt.Errorf("collection %d is not in this scope", id)
			}
			if err := tx.Model(&models.Collection{}).
				Where("id = ?", id).
				Update("position", i).Error; err != nil {
				return fmt.Errorf("reordering collection %d: %w", id, err)
			}
		}
		return renumberRemainingCollections(tx, connectionID, orderedIDs)
	})
}

// renumberRemainingCollections puts every folder in the scope that orderedIDs
// left out after the listed ones, keeping the order they were already in.
func renumberRemainingCollections(tx *gorm.DB, connectionID *uint, listed []uint) error {
	query := scopedCollections(tx.Model(&models.Collection{}), connectionID)
	if len(listed) > 0 {
		query = query.Where("id NOT IN ?", listed)
	}
	var remaining []models.Collection
	if err := query.Order("position asc, id asc").Find(&remaining).Error; err != nil {
		return err
	}
	for i, collection := range remaining {
		if err := tx.Model(&models.Collection{}).
			Where("id = ?", collection.ID).
			Update("position", len(listed)+i).Error; err != nil {
			return fmt.Errorf("reordering collection %d: %w", collection.ID, err)
		}
	}
	return nil
}

// sameCollectionScope reports whether two collection scopes match, treating nil
// (global) as its own scope rather than a wildcard.
func sameCollectionScope(a *uint, b *uint) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// DeleteCollection removes a collection and all messages in it.
func (a *App) DeleteCollection(id uint) error {
	return a.Db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("collection_id = ?", id).Delete(&models.CollectionMessage{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&models.CollectionCollapsedState{}, id).Error; err != nil {
			return err
		}
		return tx.Delete(&models.Collection{}, id).Error
	})
}

func (a *App) SetCollectionCollapsed(collectionID uint, collapsed bool) error {
	return a.Db.Save(&models.CollectionCollapsedState{ID: collectionID, Collapsed: collapsed}).Error
}

func (a *App) GetCollectionCollapsedStates() ([]models.CollectionCollapsedState, error) {
	var states []models.CollectionCollapsedState
	if res := a.Db.Find(&states); res.Error != nil {
		return nil, res.Error
	}
	return states, nil
}

type SaveCollectionMessageParams struct {
	// nil = create new message, otherwise update existing
	ID                           *uint   `json:"id"`
	CollectionID                 uint    `json:"collectionId"`
	Name                         string  `json:"name"`
	Topic                        string  `json:"topic"`
	Payload                      string  `json:"payload"`
	QoS                          uint    `json:"qos"`
	Retain                       bool    `json:"retain"`
	Encoding                     string  `json:"encoding"`
	Format                       string  `json:"format"`
	HeaderContentType            *string `json:"headerContentType"`
	HeaderResponseTopic          *string `json:"headerResponseTopic"`
	HeaderCorrelationData        *string `json:"headerCorrelationData"`
	HeaderPayloadFormatIndicator *bool   `json:"headerPayloadFormatIndicator"`
	HeaderMessageExpiryInterval  *int32  `json:"headerMessageExpiryInterval"`
	HeaderTopicAlias             *int32  `json:"headerTopicAlias"`
	HeaderSubscriptionIdentifier *int32  `json:"headerSubscriptionIdentifier"`
	UserPropertiesString         *string `json:"userProperties"`
}

// requireCollection returns a clear error when no collection has the given
// id, and the raw database error for anything else.
func (a *App) requireCollection(id uint) error {
	err := a.Db.First(&models.Collection{}, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("collection %d not found", id)
	}
	return err
}

// nextMessagePosition returns the position that appends to the end of a
// collection, 0 when the collection is empty.
func nextMessagePosition(tx *gorm.DB, collectionID uint) (int, error) {
	var highest *int
	if err := tx.Model(&models.CollectionMessage{}).
		Where("collection_id = ?", collectionID).
		Select("MAX(position)").
		Scan(&highest).Error; err != nil {
		return 0, err
	}
	if highest == nil {
		return 0, nil
	}
	return *highest + 1, nil
}

func (a *App) SaveCollectionMessage(params SaveCollectionMessageParams) (models.CollectionMessage, error) {
	if err := a.requireCollection(params.CollectionID); err != nil {
		return models.CollectionMessage{}, err
	}
	message := models.CollectionMessage{}
	if params.ID != nil {
		if err := a.Db.First(&message, *params.ID).Error; err != nil {
			return models.CollectionMessage{}, err
		}
	}
	// A new message, or one landing in a different collection, appends at the
	// end of the target collection. An in-place edit keeps its position.
	if params.ID == nil || message.CollectionID != params.CollectionID {
		position, err := nextMessagePosition(&a.Db.DB, params.CollectionID)
		if err != nil {
			return models.CollectionMessage{}, err
		}
		message.Position = position
	}
	message.CollectionID = params.CollectionID
	message.Name = params.Name
	message.Topic = params.Topic
	message.Payload = params.Payload
	message.QoS = params.QoS
	message.Retain = params.Retain
	message.Encoding = params.Encoding
	message.Format = params.Format
	message.UserProperties = params.UserPropertiesString
	message.HeaderContentType = params.HeaderContentType
	message.HeaderResponseTopic = params.HeaderResponseTopic
	message.HeaderCorrelationData = params.HeaderCorrelationData
	message.HeaderPayloadFormatIndicator = params.HeaderPayloadFormatIndicator
	message.HeaderMessageExpiryInterval = params.HeaderMessageExpiryInterval
	message.HeaderTopicAlias = params.HeaderTopicAlias
	message.HeaderSubscriptionIdentifier = params.HeaderSubscriptionIdentifier

	if err := a.Db.Save(&message).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	return message, nil
}

func (a *App) RenameCollectionMessage(id uint, name string) (models.CollectionMessage, error) {
	var message models.CollectionMessage
	if err := a.Db.First(&message, id).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	message.Name = name
	if err := a.Db.Save(&message).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	return message, nil
}

// ReorderCollectionMessages rewrites a collection's message order. orderedIDs
// is the collection's full new order; an id currently held by another
// collection moves into this one at that index, so a single call serves both a
// same-folder reorder and a cross-folder drop at a position. The gaps this
// leaves in the source collection's positions are intentional: only relative
// order is ever read back.
//
// orderedIDs does not have to be the whole collection. Anything left out keeps
// its relative order and follows the listed messages, so no two rows in a
// collection end up sharing a position.
func (a *App) ReorderCollectionMessages(collectionID uint, orderedIDs []uint) ([]models.CollectionMessage, error) {
	if err := a.requireCollection(collectionID); err != nil {
		return nil, err
	}
	if err := rejectDuplicateIDs(orderedIDs); err != nil {
		return nil, err
	}
	var messages []models.CollectionMessage
	err := a.Db.Transaction(func(tx *gorm.DB) error {
		messages = make([]models.CollectionMessage, 0, len(orderedIDs))
		for i, id := range orderedIDs {
			var message models.CollectionMessage
			if err := tx.First(&message, id).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return fmt.Errorf("message %d not found", id)
				}
				return err
			}
			message.CollectionID = collectionID
			message.Position = i
			if err := tx.Save(&message).Error; err != nil {
				return fmt.Errorf("reordering message %d: %w", id, err)
			}
			messages = append(messages, message)
		}
		return renumberRemainingMessages(tx, collectionID, orderedIDs)
	})
	if err != nil {
		return nil, err
	}
	return messages, nil
}

// renumberRemainingMessages puts every message in the collection that
// orderedIDs left out after the listed ones, keeping the order they were
// already in.
func renumberRemainingMessages(tx *gorm.DB, collectionID uint, listed []uint) error {
	query := tx.Model(&models.CollectionMessage{}).Where("collection_id = ?", collectionID)
	if len(listed) > 0 {
		query = query.Where("id NOT IN ?", listed)
	}
	var remaining []models.CollectionMessage
	if err := query.Order("position asc, id asc").Find(&remaining).Error; err != nil {
		return err
	}
	for i, message := range remaining {
		if err := tx.Model(&models.CollectionMessage{}).
			Where("id = ?", message.ID).
			Update("position", len(listed)+i).Error; err != nil {
			return fmt.Errorf("reordering message %d: %w", message.ID, err)
		}
	}
	return nil
}

// MoveCollectionMessage moves a message to another collection, appending it at
// the end of that collection.
func (a *App) MoveCollectionMessage(id uint, targetCollectionID uint) (models.CollectionMessage, error) {
	var message models.CollectionMessage
	if err := a.Db.First(&message, id).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	if err := a.requireCollection(targetCollectionID); err != nil {
		return models.CollectionMessage{}, err
	}
	position, err := nextMessagePosition(&a.Db.DB, targetCollectionID)
	if err != nil {
		return models.CollectionMessage{}, err
	}
	message.CollectionID = targetCollectionID
	message.Position = position
	if err := a.Db.Save(&message).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	return message, nil
}

// DuplicateCollectionMessage copies a message in directly after the original,
// shifting everything below it down one place.
func (a *App) DuplicateCollectionMessage(id uint) (models.CollectionMessage, error) {
	var message models.CollectionMessage
	if err := a.Db.First(&message, id).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	copy := message
	copy.ID = 0
	copy.Name = fmt.Sprintf("%s copy", message.Name)
	copy.Position = message.Position + 1
	if err := a.Db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.CollectionMessage{}).
			Where("collection_id = ? AND position > ?", message.CollectionID, message.Position).
			UpdateColumn("position", gorm.Expr("position + 1")).Error; err != nil {
			return fmt.Errorf("making room after message %d: %w", id, err)
		}
		return tx.Create(&copy).Error
	}); err != nil {
		return models.CollectionMessage{}, err
	}
	return copy, nil
}

func (a *App) DeleteCollectionMessage(id uint) error {
	return a.Db.Delete(&models.CollectionMessage{}, id).Error
}

// deleteCollectionsForConnection removes connection-scoped collections and
// their messages. Global collections are untouched.
func deleteCollectionsForConnection(tx *gorm.DB, connectionID uint) error {
	var collectionIDs []uint
	if err := tx.Model(&models.Collection{}).
		Where("connection_id = ?", connectionID).
		Pluck("id", &collectionIDs).Error; err != nil {
		return err
	}
	if len(collectionIDs) == 0 {
		return nil
	}
	if err := tx.Where("collection_id IN ?", collectionIDs).Delete(&models.CollectionMessage{}).Error; err != nil {
		return err
	}
	if err := tx.Where("id IN ?", collectionIDs).Delete(&models.CollectionCollapsedState{}).Error; err != nil {
		return err
	}
	return tx.Where("connection_id = ?", connectionID).Delete(&models.Collection{}).Error
}
