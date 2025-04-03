package app

import (
	"context"
	db "mqtt-viewer/backend/db"
	eventRuntime "mqtt-viewer/backend/event-runtime"
	"mqtt-viewer/backend/matchers"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/paths"
	"mqtt-viewer/backend/protobuf"
	"mqtt-viewer/backend/update"
	"mqtt-viewer/events"
)

type App struct {
	ctx            context.Context
	Mode           AppMode
	Paths          paths.Paths
	Db             *db.DB
	EventRuntime   *eventRuntime.EventRuntime
	Events         *events.ConnectionEvents
	Version        string
	AppConnections map[uint]*AppConnection
	Updater        *update.Updater
	ProtoRegistry  *protobuf.ProtoRegistry
}

type AppConnection struct {
	ctx                 *context.Context
	ConnectionId        uint
	MqttManager         *mqtt.MqttManager
	SubscriptionMatcher *matchers.SubscriptionMatcher
	MqttMessageBuffer   *mqtt.MessageBuffer
	EventSet            *events.ConnectionEventsSet
}

func NewApp(appMode AppMode, version string) *App {
	return &App{
		Mode:    appMode,
		Version: version,
	}
}
