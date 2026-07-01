package app

import (
	"context"
	db "mqtt-viewer/backend/db"
	eventRuntime "mqtt-viewer/backend/event-runtime"
	"mqtt-viewer/backend/mqtt"
	"mqtt-viewer/backend/paths"
	"mqtt-viewer/backend/protobuf"
	topicmatching "mqtt-viewer/backend/topic-matching"
	"mqtt-viewer/backend/update"
	"mqtt-viewer/events"
	"sync/atomic"
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
	// Cached so the 300ms message-buffer drain doesn't hit the DB to decide
	// whether to persist; kept in sync by loadRetentionSettings / UpdateAppSettings.
	recordingEnabled atomic.Bool
	diskBudgetBytes  atomic.Int64
	// Throttles the (PRAGMA-based) disk-size check so it doesn't run on every
	// 300ms drain. Unix-nano of the last prune check.
	lastPruneCheckNanos atomic.Int64
}

type AppConnection struct {
	ctx                 *context.Context
	ConnectionId        uint
	MqttManager         *mqtt.MqttManager
	SubscriptionMatcher *topicmatching.SubscriptionMatcher
	MqttMessageBuffer   *mqtt.MessageBuffer
	EventSet            *events.ConnectionEventsSet
}

func NewApp(appMode AppMode, version string) *App {
	return &App{
		Mode:    appMode,
		Version: version,
	}
}
