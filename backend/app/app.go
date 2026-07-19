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
	// recordQueue hands drained batches to the single recording-worker
	// goroutine so DB writes never happen on the buffer-drain hot path.
	recordQueue chan recordBatch
	recordStop  chan struct{}
	// recordDropped counts batches shed because recordQueue was full.
	recordDropped atomic.Int64
	// Throttles the "record queue full" warning the same way lastPruneCheckNanos
	// throttles the prune check.
	lastRecordDropLogNanos atomic.Int64
	// connectedConnCount tracks how many connections are currently up, so the
	// soft runtime memory limit (memlimit.go) can scale with live connection
	// count rather than assuming every saved connection is active.
	connectedConnCount atomic.Int64
}

type AppConnection struct {
	ctx                 *context.Context
	ConnectionId        uint
	MqttManager         *mqtt.MqttManager
	SubscriptionMatcher *topicmatching.SubscriptionMatcher
	MqttMessageBuffer   *mqtt.MessageBuffer
	EventSet            *events.ConnectionEventsSet
	// connUp guards connectedConnCount against double-counting: the
	// underlying manager's OnConnectionUp/OnConnectionDown callbacks are not
	// guaranteed to alternate (e.g. Disconnect() on an already-down
	// connection, or repeated Connected transitions on reconnect) and are not
	// guaranteed to be serialised onto one goroutine, so counting is gated by
	// a CompareAndSwap rather than trusting callback alternation.
	connUp atomic.Bool
}

func NewApp(appMode AppMode, version string) *App {
	return &App{
		Mode:    appMode,
		Version: version,
	}
}
