package mqtt

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	mqttV5Auto "github.com/eclipse/paho.golang/autopaho"
	mqttV3 "github.com/eclipse/paho.mqtt.golang"
)

// LOG_EMIT_INTERVAL coalesces client-log lines into batches before emitting to
// the frontend, so a chatty debug stream can't flood the IPC bridge.
const LOG_EMIT_INTERVAL = 300 * time.Millisecond

type MqttManager struct {
	ctx                 context.Context
	ConnectionState     ConnectionState
	MessageBuffer       *MessageBuffer
	MessageHistory      *MessageHistory
	LogStore            *LogStore
	connectionCallbacks *MqttConnectionCallbacks
	connection          *mqttActiveConnection
	middleware          *MqttMiddlewares
	stats               *ConnectionStats
	pinger              *PingerV5
	onNewLatencyMs      func(int32)
}

type MqttConnectionCallbacks struct {
	OnConnecting      func()
	OnConnectionUp    func()
	OnConnectionDown  func(cause *error)
	OnReconnecting    func(cause *error)
	OnConnectionError func(cause *error)
}

type mqttActiveConnection struct {
	clientId      string
	mqttVersion   string
	cancelConnect context.CancelFunc
	connectionCtx context.Context
	v5Connection  *mqttV5Auto.ConnectionManager
	v3Connection  *mqttV3.Client
}

func NewMqttManager(ctx context.Context, onNewLatencyMs func(int32)) *MqttManager {
	return &MqttManager{
		ctx:             ctx,
		ConnectionState: ConnectionStates.Disconnected,
		MessageBuffer:   newMessageBuffer(),
		MessageHistory:  newMessageHistory(),
		LogStore:        newLogStore(0),
		connection:      nil,
		middleware:      newMiddleware(),
		stats:           newStats(),
		onNewLatencyMs:  onNewLatencyMs,
	}
}

// InitLogging wires this connection's client-log store to a durable file and
// starts emitting batches to the frontend. connId identifies the connection for
// the v3 global-logger dispatcher; debugEnabled seeds the verbose toggle.
func (m *MqttManager) InitLogging(connId uint, filePath string, debugEnabled bool, onBatch func([]LogEntry)) {
	m.LogStore.connId = connId
	m.LogStore.SetDebugEnabled(debugEnabled)
	if err := m.LogStore.InitFile(filePath); err != nil {
		slog.ErrorContext(m.ctx, fmt.Sprintf("client log file init failed, logging to memory only: %v", err))
	}
	m.LogStore.StartEmitting(LOG_EMIT_INTERVAL, onBatch)
	installV3GlobalLoggers()
}

// SetDebugLoggingEnabled toggles verbose library debug capture for this
// connection. For an active v3 connection it also (de)registers the global v3
// dispatcher, since paho v3 loggers are process-global.
func (m *MqttManager) SetDebugLoggingEnabled(enabled bool) {
	m.LogStore.SetDebugEnabled(enabled)
	if m.connection != nil && m.connection.mqttVersion == "3" {
		if enabled {
			v3Registry.register(m.LogStore)
		} else {
			v3Registry.unregister(m.LogStore.connId)
		}
	}
}

func (m *MqttManager) GetLogs() []LogEntry {
	return m.LogStore.Snapshot()
}

func (m *MqttManager) ClearLogs() {
	m.LogStore.Clear()
}

func (m *MqttManager) SetConnectionCallbacks(callbacks MqttConnectionCallbacks) {
	m.connectionCallbacks = &callbacks
}

func (m *MqttManager) ClearConnectionHistory() {
	m.MessageHistory.Clear()
}

// SetMessageMemoryBudget bounds the in-RAM message history for this connection.
func (m *MqttManager) SetMessageMemoryBudget(budgetBytes int64) {
	m.MessageHistory.SetBudgetBytes(budgetBytes)
}

func (m *MqttManager) SetConnectionState(state ConnectionState, reason *error) {
	if m.ConnectionState == state {
		slog.DebugContext(m.ctx, fmt.Sprintf("connection state already %s", state))
	}
	if reason != nil {
		msg := fmt.Sprintf("connection state changed from %s to %s: %s", m.ConnectionState, state, (*reason).Error())
		slog.ErrorContext(m.ctx, msg)
		m.LogStore.Error(msg)
	} else {
		msg := fmt.Sprintf("connection state changed from %s to %s", m.ConnectionState, state)
		slog.InfoContext(m.ctx, msg)
		m.LogStore.Info(msg)
	}
	m.ConnectionState = state
	switch state {
	case ConnectionStates.Connecting:
		if m.connectionCallbacks.OnConnecting != nil {
			m.connectionCallbacks.OnConnecting()
		}
	case ConnectionStates.Connected:
		if m.connectionCallbacks.OnConnectionUp != nil {
			m.connectionCallbacks.OnConnectionUp()
		}
	case ConnectionStates.Disconnected:
		if m.connectionCallbacks.OnConnectionDown != nil {
			m.connectionCallbacks.OnConnectionDown(reason)
		}
	case ConnectionStates.Reconnecting:
		if m.connectionCallbacks.OnReconnecting != nil {
			m.connectionCallbacks.OnReconnecting(reason)
		}
	}
}

func (m *MqttManager) UseMiddleware(middleware MqttMiddlewares) {
	m.middleware = &middleware
}

func (m *MqttManager) GetStats() ConnectionStats {
	stats := *m.stats
	return stats
}
