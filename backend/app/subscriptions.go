package app

import (
	"mqtt-viewer/backend/models"
)

func (a *App) GetAllSubscriptionsByConnectionId() map[uint][]models.Subscription {
	result := make(map[uint][]models.Subscription)
	for id, appConn := range a.AppConnections {
		result[id] = appConn.Connection.Subscriptions
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
	conn := a.AppConnections[connectionId].Connection
	conn.Subscriptions = append(conn.Subscriptions, sub)
	return &sub, nil
}

func (a *App) UpdateSubscription(connId uint, sub models.Subscription) (*models.Subscription, error) {
	if res := a.Db.Model(&sub).Updates(&sub); res.Error != nil {
		return nil, res.Error
	}
	conn := a.AppConnections[sub.ConnectionID].Connection
	for i, s := range conn.Subscriptions {
		if s.ID == sub.ID {
			conn.Subscriptions[i] = sub
			break
		}
	}
	return &sub, nil
}

func (a *App) DeleteSubscription(connId uint, id uint) error {
	if res := a.Db.Delete(&models.Subscription{}, id); res.Error != nil {
		return res.Error
	}
	conn := a.AppConnections[connId].Connection
	for i, s := range conn.Subscriptions {
		if s.ID == uint(id) {
			conn.Subscriptions = append(conn.Subscriptions[:i], conn.Subscriptions[i+1:]...)
			break
		}
	}
	return nil
}
