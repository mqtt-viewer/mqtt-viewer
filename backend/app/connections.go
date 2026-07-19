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
	"os"

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
	customIconSeed := ""
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
		CustomIconSeed:    &customIconSeed,
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

	passwordHasChanged := conn.Password != nil && *conn.Password != "" && (existingConnection.Password == nil || *conn.Password != *existingConnection.Password)
	if passwordHasChanged {
		// Encrypt the incoming password from the frontend
		encryptedPassword, err := cryptography.EncryptBytesForMachine(env.MachineId, []byte(*conn.Password))
		if err != nil {
			return err
		}
		encrypted := string(encryptedPassword)
		conn.Password = &encrypted
	}

	updated := models.Connection{
		ID: conn.ID,
	}
	// proto_reg_dir is owned by the proto-import operations (ImportProtoDir,
	// ImportProtoFiles, ReimportProto, ClearProtoImport) now, not by the
	// connection edit form; omit it so a frontend row holding a stale
	// ProtoRegDir pointer (fetched before an import changed it) can't
	// silently revert it on save.
	err := a.Db.Model(updated).Omit("proto_reg_dir").Updates(conn)
	if err.Error != nil {
		return err.Error
	}

	// Update name stored in ctx for logging
	newCtx := logging.ReplaceCtx(*appConnection.ctx, slog.String("name", getMqttManagerName(conn)))
	appConnection.ctx = &newCtx

	a.refreshProtoStateAfterConnectionUpdate(appConnection, &existingConnection, conn)

	return nil
}

// refreshProtoStateAfterConnectionUpdate keeps the live protoState's enabled
// flag in sync when a connection edit touches IsProtoEnabled. Proto imports
// (ImportProtoDir, ImportProtoFiles, ReimportProto, ClearProtoImport) manage
// ProtoRegDir and the compiled registry themselves; UpdateConnection no
// longer touches either.
func (a *App) refreshProtoStateAfterConnectionUpdate(appConnection *AppConnection, existing *models.Connection, updated *models.Connection) {
	oldEnabled := existing.IsProtoEnabled != nil && *existing.IsProtoEnabled
	newEnabled := oldEnabled
	if updated.IsProtoEnabled != nil {
		newEnabled = *updated.IsProtoEnabled
	}

	if newEnabled == oldEnabled {
		return
	}

	appConnection.ProtoState.SetEnabled(newEnabled)
	a.emitProtoStateChanged(updated.ID)
}

func (a *App) DeleteConnection(id uint) error {
	err := a.Db.Transaction(func(tx *gorm.DB) error {
		if res := tx.Where("connection_id = ?", id).Delete(&models.Subscription{}); res.Error != nil {
			return res.Error
		}
		if res := tx.Where("connection_id = ?", id).Delete(&models.Tab{}); res.Error != nil {
			return res.Error
		}
		if err := deleteCollectionsForConnection(tx, id); err != nil {
			return err
		}
		if res := tx.Where("connection_id = ?", id).Delete(&models.ReceivedMessage{}); res.Error != nil {
			return res.Error
		}
		if res := tx.Delete(&models.Connection{}, id); res.Error != nil {
			return res.Error
		}
		return nil
	})
	if err != nil {
		return err
	}
	if err := os.RemoveAll(a.protoImportDir(id)); err != nil {
		slog.Error("failed to remove proto import dir", "connectionId", id, "error", err)
	}
	delete(a.AppConnections, id)
	if a.Mode != AppModes.Test {
		a.EventRuntime.EventsEmit(string(events.ConnectionDeleted), id)
	}
	return nil
}
