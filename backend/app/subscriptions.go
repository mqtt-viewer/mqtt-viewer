package app

import (
	"mqtt-viewer/backend/models"
)

func (a *App) GetAllSubscriptionsByConnectionId() map[uint][]models.Subscription {
	result := make(map[uint][]models.Subscription)
	subscriptions := []models.Subscription{}
	if res := a.Db.Find(&subscriptions); res.Error != nil {
		return result
	}
	for _, sub := range subscriptions {
		if _, ok := result[sub.ConnectionID]; !ok {
			result[sub.ConnectionID] = []models.Subscription{}
		}
		result[sub.ConnectionID] = append(result[sub.ConnectionID], sub)
	}
	return result
}

func (a *App) AddSubscription(connectionId uint) (*models.Subscription, error) {
	var qos uint = 0
	sub := models.Subscription{
		ConnectionID: connectionId,
		Topic:        "",
		QoS:          &qos,
	}
	if res := a.Db.Create(&sub); res.Error != nil {
		return nil, res.Error
	}
	return &sub, nil
}

func (a *App) UpdateSubscription(connId uint, sub models.Subscription) (*models.Subscription, error) {
	if res := a.Db.Model(&sub).Updates(&sub); res.Error != nil {
		return nil, res.Error
	}
	return &sub, nil
}

func (a *App) DeleteSubscription(connId uint, id uint) error {
	if res := a.Db.Delete(&models.Subscription{}, id); res.Error != nil {
		return res.Error
	}
	return nil
}
