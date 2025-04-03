package app

import (
	"fmt"
	"log/slog"
	"mqtt-viewer/backend/cryptography"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/backend/logging"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/events"

	"gopkg.in/guregu/null.v4"
	"gorm.io/gorm"
)

// Used to represent a connection in the frontend
type Connection struct {
	ConnectionDetails models.Connection          `json:"connectionDetails"`
	IsConnected       bool                       `json:"isConnected"`
	EventSet          events.ConnectionEventsSet `json:"eventSet"`
}

type Connections struct {
	Connections map[uint]Connection `json:"connections"`
}

func (a *App) GetAllConnections() Connections {
	result := make(map[uint]Connection)
	for id, appConn := range a.AppConnections {
		connectionDetails := models.Connection{}
		if res := a.Db.First(&connectionDetails, id); res.Error != nil {
			slog.Error("Failed to get connection details", "error", res.Error)
			continue
		}
		result[id] = Connection{
			ConnectionDetails: connectionDetails,
			IsConnected:       appConn.MqttManager.ConnectionState == mqtt.ConnectionStates.Connected,
			EventSet:          *appConn.EventSet,
		}
	}
	return Connections{
		Connections: result,
	}
}

func (a *App) NewConnection() (*Connection, error) {
	port := 1883
	isProtoEnabled := false
	isCertsEnabled := false
	hasCustomClientId := false
	var qos uint = 0
	conn := models.Connection{
		Protocol:          "mqtt",
		Host:              "localhost",
		Port:              port,
		Name:              "New Connection",
		MqttVersion:       "5",
		HasCustomClientId: &hasCustomClientId,
		IsProtoEnabled:    &isProtoEnabled,
		IsCertsEnabled:    &isCertsEnabled,
		CustomIconSeed:    null.StringFrom(""),
		Subscriptions: []models.Subscription{
			{
				Topic: "#",
				QoS:   &qos,
			},
			{
				Topic: "$SYS/#",
				QoS:   &qos,
			},
		},
	}
	tab := models.Tab{}
	err := a.Db.Transaction(func(tx *gorm.DB) error {
		var countOpenTabs int64
		if err := a.Db.Model(&models.Tab{}).Count(&countOpenTabs).Error; err != nil {
			return err
		}
		if connRes := tx.Create(&conn); connRes.Error != nil {
			return connRes.Error
		}
		tab.ConnectionID = conn.ID
		tab.TabIndex = uint(countOpenTabs)
		if tabRes := tx.Create(&tab); tabRes.Error != nil {
			return tabRes.Error
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	eventSet := a.Events.GetConnectionEventsSet(conn.ID)
	appConnection, err := a.createAppConnectionFromConnectionModel(&conn, a.Events)
	if err != nil {
		return nil, err
	}
	a.AppConnections[conn.ID] = appConnection
	return &Connection{
		ConnectionDetails: conn,
		IsConnected:       false,
		EventSet:          eventSet,
	}, nil
}

func (a *App) UpdateConnection(conn *models.Connection) error {
	appConnection, ok := a.AppConnections[conn.ID]
	if !ok {
		return fmt.Errorf("connection not found")
	}

	existingConnection := models.Connection{}
	if res := a.Db.First(&existingConnection, conn.ID); res.Error != nil {
		return res.Error
	}

	passwordHasChanged := conn.Password.Valid && conn.Password.String != "" && (!existingConnection.Password.Valid || conn.Password.String != existingConnection.Password.String)
	if passwordHasChanged {
		// Encrypt the incoming password from the frontend
		encryptedPassword, err := cryptography.EncryptBytesForMachine(env.MachineId, []byte(conn.Password.String))
		if err != nil {
			return err
		}
		conn.Password.String = string(encryptedPassword)
	}

	updated := models.Connection{
		ID: conn.ID,
	}
	err := a.Db.Model(updated).Updates(conn)
	if err.Error != nil {
		return err.Error
	}

	// Update name stored in ctx for logging
	newCtx := logging.ReplaceCtx(*appConnection.ctx, slog.String("name", getMqttManagerName(conn)))
	appConnection.ctx = &newCtx

	return nil
}

func (a *App) DeleteConnection(id uint) error {
	if res := a.Db.Where("connection_id = ?", id).Delete(&models.Subscription{}); res.Error != nil {
		return res.Error
	}
	if res := a.Db.Where("connection_id = ?", id).Delete(&models.Tab{}); res.Error != nil {
		return res.Error
	}
	if res := a.Db.Delete(&models.Connection{}, id); res.Error != nil {
		return res.Error
	}
	delete(a.AppConnections, id)
	a.EventRuntime.EventsEmit(string(events.ConnectionDeleted), id)
	return nil
}
