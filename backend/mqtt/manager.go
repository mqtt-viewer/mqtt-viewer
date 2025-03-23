package mqtt

import (
	"context"
	"fmt"
	"log/slog"

	mqttV5Auto "github.com/eclipse/paho.golang/autopaho"
	mqttV3 "github.com/eclipse/paho.mqtt.golang"
)

type MqttManager struct {
	ctx                 context.Context
	ConnectionState     ConnectionState
	MessageBuffer       *MessageBuffer
	MessageHistory      *MessageHistory
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
		connection:      nil,
		middleware:      newMiddleware(),
		stats:           newStats(),
		onNewLatencyMs:  onNewLatencyMs,
	}
}

func (m *MqttManager) SetConnectionCallbacks(callbacks MqttConnectionCallbacks) {
	m.connectionCallbacks = &callbacks
}

func (m *MqttManager) ClearConnectionHistory() {
	m.MessageHistory = newMessageHistory()
}

func (m *MqttManager) SetConnectionState(state ConnectionState, reason *error) {
	if m.ConnectionState == state {
		slog.DebugContext(m.ctx, fmt.Sprintf("connection state already %s", state))
	}
	if reason != nil {
		slog.ErrorContext(m.ctx, fmt.Sprintf("connection state changed from %s to %s: %s", m.ConnectionState, state, (*reason).Error()))
	} else {
		slog.InfoContext(m.ctx, fmt.Sprintf("connection state changed from %s to %s", m.ConnectionState, state))
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
