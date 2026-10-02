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
	for id, appConn := range a.appConnectionsSnapshot() {
		connectionDetails := models.Connection{}
		if res := a.Db.First(&connectionDetails, id); res.Error != nil {
			slog.Error("failed to load connection details, skipping connection", "conn_id", id, "error", res.Error)
			continue
		}
		result[id] = Connection{
			ConnectionDetails: connectionDetails,
			IsConnected:       appConn.MqttManager.GetConnectionState() == mqtt.ConnectionStates.Connected,
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
	a.setAppConnection(conn.ID, appConnection)
	return &Connection{
		ConnectionDetails: conn,
		IsConnected:       false,
		EventSet:          eventSet,
	}, nil
}

func (a *App) UpdateConnection(conn *models.Connection) error {
	appConnection, ok := a.appConnection(conn.ID)
	if !ok {
		return fmt.Errorf("connection not found")
	}

	if err := a.encryptIncomingPassword(conn); err != nil {
		return err
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

	a.refreshProtoStateAfterConnectionUpdate(appConnection, conn)

	return nil
}

// encryptIncomingPassword encrypts the password a connection update carries.
//
// The frontend holds the decrypted password (AfterFind decrypts on load), so
// a non-empty value it sends back is plaintext and must be encrypted, changed
// or not. Comparing against the decrypted row used to skip this for an
// unchanged password and write it back in the clear. The one value to leave
// alone is the raw stored one, which reaches the frontend whenever the row
// does not decrypt here: ciphertext from another machine, which encrypting
// again would only bury deeper.
//
// That also covers a plaintext password the startup repair
// (encryptPlaintextPasswords) could not tell from foreign ciphertext: one
// that decodes as unpadded base64 to a nonce and a tag or more (38 or more
// characters, all from the base64 alphabet). It stays in the clear until the
// password is changed. Without the other machine's key there is no way to
// tell the two apart (TestBase64LookingPlaintextPasswordStaysInTheClear).
func (a *App) encryptIncomingPassword(conn *models.Connection) error {
	if conn.Password == nil || *conn.Password == "" {
		return nil
	}
	var storedPassword *string
	if res := a.Db.Raw("SELECT password FROM connections WHERE id = ?", conn.ID).Scan(&storedPassword); res.Error != nil {
		return res.Error
	}
	if storedPassword != nil && *conn.Password == *storedPassword {
		return nil
	}
	encryptedPassword, err := cryptography.EncryptBytesForMachine(env.MachineId, []byte(*conn.Password))
	if err != nil {
		return err
	}
	conn.Password = &encryptedPassword
	return nil
}

// refreshProtoStateAfterConnectionUpdate keeps the live protoState's enabled
// flag in sync when a connection edit touches IsProtoEnabled. Proto imports
// (ImportProtoDir, ImportProtoFiles, ReimportProto, ClearProtoImport) manage
// ProtoRegDir and the compiled registry themselves; UpdateConnection never
// touches either.
func (a *App) refreshProtoStateAfterConnectionUpdate(appConnection *AppConnection, updated *models.Connection) {
	if updated.IsProtoEnabled == nil {
		return
	}
	newEnabled := *updated.IsProtoEnabled
	if newEnabled == appConnection.ProtoState.IsEnabled() {
		return
	}
	appConnection.ProtoState.SetEnabled(newEnabled)
	a.emitProtoStateChanged(updated.ID)
}

func (a *App) DeleteConnection(id uint) error {
	// Durable history can run to millions of rows; sweep the bulk of it in
	// short chunked deletes first so the transaction below never holds the
	// write lock for the whole sweep. The in-transaction delete catches
	// anything recorded since.
	if err := a.deleteReceivedMessagesChunked(id); err != nil {
		return err
	}
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
		if res := tx.Where("connection_id = ?", id).Delete(&models.FilterHistory{}); res.Error != nil {
			return res.Error
		}
		if res := tx.Where("connection_id = ?", id).Delete(&models.PublishHistory{}); res.Error != nil {
			return res.Error
		}
		if res := tx.Where("connection_id = ?", id).Delete(&models.ReceivedMessage{}); res.Error != nil {
			return res.Error
		}
		if err := deletePinnedTopicsForConnection(tx, id); err != nil {
			return err
		}
		// sys_metric_mappings and proto_binding_rules have ON DELETE
		// CASCADE; every other child table uses a NO ACTION foreign key and
		// must be cleared above.
		if res := tx.Delete(&models.Connection{}, id); res.Error != nil {
			return res.Error
		}
		return nil
	})
	if err != nil {
		return err
	}
	// Release the pages freed by a potentially huge history delete (no-op
	// unless auto_vacuum is INCREMENTAL).
	a.Db.Exec("PRAGMA incremental_vacuum")
	// Stop the log store's emit goroutine and close its file before the
	// connection is dropped from the map, else they leak for the process.
	if appConnection, ok := a.appConnection(id); ok && appConnection.MqttManager != nil {
		appConnection.MqttManager.CloseLogging()
	}
	if err := os.RemoveAll(a.protoImportDir(id)); err != nil {
		slog.Error("failed to remove proto import dir", "connectionId", id, "error", err)
	}
	a.removeAppConnection(id)
	if a.Mode != AppModes.Test {
		a.EventRuntime.EventsEmit(string(events.ConnectionDeleted), id)
	}
	// A deleted connection's topic pop-out has nothing left to follow; close
	// it here (backend-side) so it goes away even if no main window is
	// listening. Silent: the dock mode must not revert on this close.
	closeTopicWindowForConnection(id)
	return nil
}
