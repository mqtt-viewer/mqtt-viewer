package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	db "mqtt-viewer/backend/db"
	"mqtt-viewer/backend/env"
	eventRuntime "mqtt-viewer/backend/event-runtime"
	"mqtt-viewer/backend/logging"
	"mqtt-viewer/backend/models"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/paths"
	"mqtt-viewer/backend/protobuf"
	"mqtt-viewer/backend/update"
	"mqtt-viewer/events"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gopkg.in/guregu/null.v4"
)

type StartupOptions struct {
	PathsOverride  *paths.Paths
	DbNameOverride *string
}

func (a *App) Startup(ctx context.Context, options *StartupOptions) {
	a.ctx = ctx
	a.Events = events.NewConnectionEvents()
	var dbConn *db.DB
	var err error
	if a.Mode == AppModes.Wails {
		a.EventRuntime = eventRuntime.InitEventRuntime(ctx)
		envInfo := runtime.Environment(a.ctx)
		if envInfo.BuildType == "production" {
			slog.Info("starting in production mode")
			a.Mode = AppModes.Wails
			a.Paths = paths.GetPaths()
			logging.InitLogger(logging.LoggerParams{
				ResourceDir:          a.Paths.ResourcePath,
				EnableDebugLogging:   false,
				EnableFileLogging:    true,
				EnableConsoleLogging: false,
			})
		} else {
			slog.Info("starting in wails development mode")
			a.Mode = AppModes.WailsDev
			a.Paths = paths.GetDevPaths()
			logging.InitLogger(logging.LoggerParams{
				ResourceDir:          a.Paths.ResourcePath,
				EnableDebugLogging:   true,
				EnableFileLogging:    false,
				EnableConsoleLogging: true,
			})
		}
		dbConn, err = db.NewDb(a.Paths.ResourcePath, &db.NewDbOptions{
			EnableConsoleLogging: false,
		})
	} else {
		// Test mode
		if options == nil || options.PathsOverride == nil {
			panic("PathsOverride must be provided when in test mode")
		}
		a.Paths = *options.PathsOverride
		dbOptions := &db.NewDbOptions{
			EnableConsoleLogging: true,
			LogLevel:             4, // info
		}
		dbConn, err = db.NewDb(a.Paths.ResourcePath, dbOptions)
	}

	if err != nil {
		slog.Error(err.Error())
		panic(err)
	}

	slog.Info(fmt.Sprintf("running MQTT Viewer %s", env.Version))
	slog.Info(fmt.Sprintf("resource path located at %s", a.Paths.ResourcePath))

	err = dbConn.Migrate()
	if err != nil {
		slog.Error(err.Error())
		panic(err)
	}
	a.Db = dbConn
	err = a.buildAppConnections()
	if err != nil {
		slog.Error(err.Error())
		panic(err)
	}

	go func() {
		err := protobuf.WriteSparkplugProtoFiles(a.Paths.ResourcePath)
		if err != nil {
			slog.ErrorContext(a.ctx, fmt.Sprintf("error writing sparkplugB proto file: %v", err))
			return
		}
		registry, err := protobuf.LoadProtoRegistry(a.Paths.ResourcePath)
		if err != nil {
			slog.ErrorContext(a.ctx, fmt.Sprintf("error loading proto registry: %v", err))
			return
		}
		a.ProtoRegistry = registry
	}()

	if a.Mode != AppModes.Test {
		updater := update.NewUpdater(a.Paths.ResourcePath, env.MachineId)
		a.Updater = updater
	}
}

func (a *App) buildAppConnections() error {
	connections, err := a.getSavedConnections()
	if err != nil {
		return err
	}
	appConnections := make(map[uint]*AppConnection)
	for _, conn := range *connections {
		localConn := conn
		appConnection, err := a.createAppConnectionFromConnectionModel(&localConn, a.Events)
		if err != nil {
			return err
		}
		appConnections[conn.ID] = appConnection
	}
	a.AppConnections = appConnections
	return nil
}

func (a *App) getSavedConnections() (*[]models.Connection, error) {
	connections := []models.Connection{}
	if res := a.Db.Model(&models.Connection{}).Preload("Subscriptions").Find(&connections); res.Error != nil {
		return nil, res.Error
	}
	return &connections, nil
}

func (a *App) createAppConnectionFromConnectionModel(conn *models.Connection, events *events.ConnectionEvents) (*AppConnection, error) {
	withId := logging.AppendCtx(context.Background(), slog.String("conn_id", fmt.Sprint(conn.ID)))
	name := getMqttManagerName(conn)
	withName := logging.AppendCtx(withId, slog.String("name", name))

	connEvents := events.GetConnectionEventsSet(conn.ID)

	withMqttModule := logging.AppendCtx(withName, slog.String("module", "mqtt"))

	onLatencyUpdate := func(latencyMs int32) {
		slog.DebugContext(withMqttModule, fmt.Sprintf("latency update: %d", latencyMs))
		if a.Mode != AppModes.Test {
			a.EventRuntime.EventsEmit(connEvents.MqttLatency, latencyMs)
		}
	}
	mqttManager := mqtt.NewMqttManager(withMqttModule, onLatencyUpdate)

	appConnection := AppConnection{
		ctx:          &withName,
		ConnectionId: conn.ID,
		MqttManager:  mqttManager,
		EventSet:     &connEvents,
	}

	mqttManager.SetConnectionCallbacks(
		mqtt.MqttConnectionCallbacks{
			OnConnecting: func() {
				if a.Mode != AppModes.Test {
					a.EventRuntime.EventsEmit(appConnection.EventSet.MqttConnecting)
				}
			},
			OnConnectionUp: func() {
				appConnection.MqttManager.MessageBuffer.StartHandlingBuffer(MQTT_BUFFER_EMIT_INTERVAL, func(messages []mqtt.MqttMessage) {
					if len(messages) == 0 {
						return
					}
					if a.Mode != AppModes.Test {
						a.EventRuntime.EventsEmit(appConnection.EventSet.MqttMessages, messages)
					}
				})
				if a.Mode != AppModes.Test {
					a.EventRuntime.EventsEmit(appConnection.EventSet.MqttConnected, nil)
				}
				// update connection last connected time in db
				err := a.Db.Model(&models.Connection{}).Where("id = ?", appConnection.ConnectionId).Update("last_connected_at", null.TimeFrom(time.Now())).Error
				if err != nil {
					slog.ErrorContext(*appConnection.ctx, fmt.Sprintf("error updating last connected time: %v", err))
				}
			},
			OnConnectionDown: func(reason *error) {
				appConnection.MqttManager.MessageBuffer.StopHandlingBuffer()
				if reason != nil {
					slog.ErrorContext(*appConnection.ctx, fmt.Sprintf("connection down: %v", (*reason).Error()))
					if a.Mode != AppModes.Test {
						a.EventRuntime.EventsEmit(appConnection.EventSet.MqttDisconnected, (*reason).Error())
					}
				} else {
					slog.InfoContext(*appConnection.ctx, "connection down")
					if a.Mode != AppModes.Test {
						a.EventRuntime.EventsEmit(appConnection.EventSet.MqttDisconnected, nil)
					}
				}
			},
			OnReconnecting: func(reason *error) {
				if reason != nil {
					slog.ErrorContext(*appConnection.ctx, fmt.Sprintf("starting reconnect due to: %v", (*reason).Error()))
					if a.Mode != AppModes.Test {
						a.EventRuntime.EventsEmit(appConnection.EventSet.MqttReconnecting, (*reason).Error())
					}
				} else {
					slog.InfoContext(*appConnection.ctx, "reconnecting to broker")
					if a.Mode != AppModes.Test {
						a.EventRuntime.EventsEmit(appConnection.EventSet.MqttReconnecting, nil)
					}
				}
			},
			OnConnectionError: func(reason *error) {
				if reason != nil {
					slog.ErrorContext(*appConnection.ctx, fmt.Sprintf("connection error: %v", (*reason).Error()))
					if a.Mode != AppModes.Test {
						a.EventRuntime.EventsEmit(appConnection.EventSet.MqttClientError, (*reason).Error())
					}
				} else {
					slog.ErrorContext(*appConnection.ctx, "connection error")
					if a.Mode != AppModes.Test {
						a.EventRuntime.EventsEmit(appConnection.EventSet.MqttClientError, nil)
					}
				}
			},
		},
	)
	return &appConnection, nil
}

func getMqttManagerName(conn *models.Connection) string {
	return conn.Name
}
