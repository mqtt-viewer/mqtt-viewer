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
	ConnectionDetails  models.Connection          `json:"connectionDetails"`
	IsConnected        bool                       `json:"isConnected"`
	LoadedProtoDetails *LoadedProtoRegistryResult `json:"loadedProtoDetails"`
	EventSet           events.ConnectionEventsSet `json:"eventSet"`
}

type Connections struct {
	Connections map[uint]Connection `json:"connections"`
}

func (a *App) GetAllConnections() Connections {
	result := make(map[uint]Connection)
	for id, appConn := range a.AppConnections {
		result[id] = Connection{
			ConnectionDetails:  *appConn.Connection,
			IsConnected:        appConn.MqttManager.ConnectionState == mqtt.ConnectionStates.Connected,
			LoadedProtoDetails: appConn.getLoadedProtoDetails(),
			EventSet:           *appConn.EventSet,
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
		ConnectionDetails:  conn,
		IsConnected:        false,
		EventSet:           eventSet,
		LoadedProtoDetails: appConnection.getLoadedProtoDetails(),
	}, nil
}

func (a *App) UpdateConnection(conn *models.Connection) (*Connection, error) {
	appConnection, ok := a.AppConnections[conn.ID]
	if !ok {
		return nil, fmt.Errorf("connection not found")
	}

	passwordIsDifferent := conn.Password.Valid && conn.Password.String != "" && (!appConnection.Connection.Password.Valid || conn.Password.String != appConnection.Connection.Password.String)
	if passwordIsDifferent {
		// Encrypt the incoming password from the frontend
		encryptedPassword, err := cryptography.EncryptBytesForMachine(env.MachineId, []byte(conn.Password.String))
		if err != nil {
			return nil, err
		}
		conn.Password.String = string(encryptedPassword)
	}
	err := a.Db.Model(&appConnection.Connection).Updates(conn)

	if appConnection.Connection.Password.Valid {
		// Gorm's hooks don't seem to fire properly when using Model().Updates(), so we need to manually unencrypt the password
		// (Gorm has been frustrating me no-end, I'd like to rip it out and replace it with something else)
		decryptedPassword, err := cryptography.DecryptBytesForMachine(env.MachineId, []byte(appConnection.Connection.Password.String))
		if err != nil {
			return nil, err
		}
		conn.Password.String = string(decryptedPassword)
		appConnection.Connection.Password.String = string(decryptedPassword)
	}

	if err.Error != nil {
		return nil, err.Error
	}

	// Update name stored in ctx for logging
	newCtx := logging.ReplaceCtx(*appConnection.ctx, slog.String("name", getMqttManagerName(conn)))
	appConnection.ctx = &newCtx

	return &Connection{
		ConnectionDetails:  *conn,
		IsConnected:        appConnection.MqttManager.ConnectionState == mqtt.ConnectionStates.Connected,
		EventSet:           *appConnection.EventSet,
		LoadedProtoDetails: appConnection.getLoadedProtoDetails(),
	}, nil
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

func (ac *AppConnection) getLoadedProtoDetails() *LoadedProtoRegistryResult {
	if ac.LoadedProtoRegistry == nil {
		return nil
	}
	return &LoadedProtoRegistryResult{
		Dir:                            ac.LoadedProtoRegistry.Dir,
		LoadedFileNamesWithDescriptors: *ac.LoadedProtoRegistry.LoadedFilesWithDescriptorsMap,
	}
}
