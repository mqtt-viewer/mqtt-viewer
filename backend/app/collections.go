package app

import (
	"fmt"
	"mqtt-viewer/backend/models"

	"gorm.io/gorm"
)

// GetCollectionsForConnection returns global collections (connection_id IS NULL)
// plus collections scoped to the given connection, messages preloaded.
func (a *App) GetCollectionsForConnection(connectionID uint) ([]models.Collection, error) {
	var collections []models.Collection
	if err := a.Db.
		Where("connection_id = ? OR connection_id IS NULL", connectionID).
		Preload("Messages", func(db *gorm.DB) *gorm.DB {
			return db.Order("collection_messages.name COLLATE NOCASE asc")
		}).
		Order("name COLLATE NOCASE asc").
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
	collection := models.Collection{
		Name:         params.Name,
		ConnectionID: params.ConnectionID,
		Messages:     []models.CollectionMessage{},
	}
	if err := a.Db.Create(&collection).Error; err != nil {
		return models.Collection{}, err
	}
	return collection, nil
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

// DeleteCollection removes a collection and all messages in it.
func (a *App) DeleteCollection(id uint) error {
	return a.Db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("collection_id = ?", id).Delete(&models.CollectionMessage{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.Collection{}, id).Error
	})
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
	ProtoOverride                *string `json:"protoOverride"`
}

func (a *App) SaveCollectionMessage(params SaveCollectionMessageParams) (models.CollectionMessage, error) {
	message := models.CollectionMessage{}
	if params.ID != nil {
		if err := a.Db.First(&message, *params.ID).Error; err != nil {
			return models.CollectionMessage{}, err
		}
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
	message.ProtoOverride = params.ProtoOverride

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

func (a *App) MoveCollectionMessage(id uint, targetCollectionID uint) (models.CollectionMessage, error) {
	var message models.CollectionMessage
	if err := a.Db.First(&message, id).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	var target models.Collection
	if err := a.Db.First(&target, targetCollectionID).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	message.CollectionID = targetCollectionID
	if err := a.Db.Save(&message).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	return message, nil
}

func (a *App) DuplicateCollectionMessage(id uint) (models.CollectionMessage, error) {
	var message models.CollectionMessage
	if err := a.Db.First(&message, id).Error; err != nil {
		return models.CollectionMessage{}, err
	}
	copy := message
	copy.ID = 0
	copy.Name = fmt.Sprintf("%s copy", message.Name)
	if err := a.Db.Create(&copy).Error; err != nil {
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
	return tx.Where("connection_id = ?", connectionID).Delete(&models.Collection{}).Error
}
