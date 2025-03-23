package app

import (
	"mqtt-viewer/backend/models"
	"time"
)

func (a *App) GetPublishHistoriesForConnection(connectionID uint) ([]models.PublishHistory, error) {
	var publishHistories []models.PublishHistory
	if err := a.Db.
		Where("connection_id = ?", connectionID).
		Order("published_at desc").
		Limit(500).
		Find(&publishHistories).Error; err != nil {
		return nil, err
	}
	return publishHistories, nil
}

type SavePublishHistoryEntryParams struct {
	ConnectionId                 uint    `json:"connectionId"`
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

func (a *App) SavePublishHistoryEntry(params SavePublishHistoryEntryParams) (models.PublishHistory, error) {
	entry := models.PublishHistory{
		ConnectionID: params.ConnectionId,
		Topic:        params.Topic,
		Payload:      params.Payload,
		QoS:          params.QoS,
		Retain:       params.Retain,
		Encoding:     params.Encoding,
		Format:       params.Format,
		PublishedAt:  time.Now(),
	}
	if params.UserPropertiesString != nil {
		entry.UserProperties = params.UserPropertiesString
	}
	if params.HeaderContentType != nil {
		entry.HeaderContentType = params.HeaderContentType
	}
	if params.HeaderResponseTopic != nil {
		entry.HeaderResponseTopic = params.HeaderResponseTopic
	}
	if params.HeaderCorrelationData != nil {
		entry.HeaderCorrelationData = params.HeaderCorrelationData
	}
	if params.HeaderPayloadFormatIndicator != nil {
		entry.HeaderPayloadFormatIndicator = params.HeaderPayloadFormatIndicator
	}
	if params.HeaderMessageExpiryInterval != nil {
		entry.HeaderMessageExpiryInterval = params.HeaderMessageExpiryInterval
	}
	if params.HeaderTopicAlias != nil {
		entry.HeaderTopicAlias = params.HeaderTopicAlias
	}
	if params.HeaderSubscriptionIdentifier != nil {
		entry.HeaderSubscriptionIdentifier = params.HeaderSubscriptionIdentifier
	}

	result := a.Db.Create(&entry)
	if result.Error != nil {
		return models.PublishHistory{}, result.Error
	}
	return entry, nil
}

func (a *App) DeletePublishHistoryEntry(id uint) error {
	err := a.Db.Where("id = ?", id).Delete(&models.PublishHistory{}).Error
	if err != nil {
		return err
	}
	return nil
}
