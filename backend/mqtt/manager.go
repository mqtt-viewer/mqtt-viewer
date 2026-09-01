package mqtt

import (
	"context"
	"fmt"
	"log/slog"
	"sync/atomic"

	mqttV5Auto "github.com/eclipse/paho.golang/autopaho"
	mqttV3 "github.com/eclipse/paho.mqtt.golang"
)

type MqttManager struct {
	ctx context.Context
	// paho's callbacks fire on their own goroutines while binding calls read
	// the state, so this is atomic rather than a plain field: ConnectionState
	// is a string, and a torn read can hand out a corrupt one. Reach it through
	// GetConnectionState / SetConnectionState.
	connectionState     atomic.Pointer[ConnectionState]
	MessageBuffer       *MessageBuffer
	MessageHistory      *MessageHistory
	connectionCallbacks *MqttConnectionCallbacks
	connection          *mqttActiveConnection
	middleware          *MqttMiddlewares
	stats               *connectionStats
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
	m := &MqttManager{
		ctx:            ctx,
		MessageBuffer:  newMessageBuffer(),
		MessageHistory: newMessageHistory(),
		connection:     nil,
		middleware:     newMiddleware(),
		stats:          newStats(),
		onNewLatencyMs: onNewLatencyMs,
	}
	m.storeConnectionState(ConnectionStates.Disconnected)
	return m
}

// GetConnectionState reports the current lifecycle state.
func (m *MqttManager) GetConnectionState() ConnectionState {
	if state := m.connectionState.Load(); state != nil {
		return *state
	}
	return ConnectionStates.Disconnected
}

func (m *MqttManager) storeConnectionState(state ConnectionState) {
	m.connectionState.Store(&state)
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
	// Read once so the log lines and the store all describe the same
	// transition, even if another callback goroutine is setting state too.
	previous := m.GetConnectionState()
	if previous == state {
		slog.DebugContext(m.ctx, fmt.Sprintf("connection state already %s", state))
	}
	if reason != nil {
		slog.ErrorContext(m.ctx, fmt.Sprintf("connection state changed from %s to %s: %s", previous, state, (*reason).Error()))
	} else {
		slog.InfoContext(m.ctx, fmt.Sprintf("connection state changed from %s to %s", previous, state))
	}
	m.storeConnectionState(state)
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
	return m.stats.snapshot()
}
