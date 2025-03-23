package events

import "fmt"

const MQTT_CONNECTED = "server:mqtt-connected"
const MQTT_DISCONNECTED = "server:mqtt-disconnected"
const MQTT_CONNECTING = "server:mqtt-connecting"
const MQTT_RECONNECTING = "server:mqtt-reconnecting"
const MQTT_MESSAGES = "server:mqtt-messages"
const MQTT_CLIENT_ERROR = "server:mqtt-client-error"
const MQTT_CONNECTED_ROUNDTRIP_LATENCY = "server:mqtt-latency"
const MQTT_CLEAR_HISTORY = "server:mqtt-clear-history"

type ConnectionEvents struct {
}

func NewConnectionEvents() *ConnectionEvents {
	return &ConnectionEvents{}
}

type ConnectionEventsSet struct {
	MqttConnected    string `json:"mqttConnected"`
	MqttDisconnected string `json:"mqttDisconnected"`
	MqttConnecting   string `json:"mqttConnecting"`
	MqttReconnecting string `json:"mqttReconnecting"`
	MqttClientError  string `json:"mqttClientError"`
	MqttMessages     string `json:"mqttMessages"`
	MqttLatency      string `json:"mqttLatency"`
	MqttClearHistory string `json:"mqttClearHistory"`
}

func (e *ConnectionEvents) GetConnectionEventsSet(connectionId uint) ConnectionEventsSet {
	return ConnectionEventsSet{
		MqttConnected:    MQTT_CONNECTED + ":" + fmt.Sprint(connectionId),
		MqttDisconnected: MQTT_DISCONNECTED + ":" + fmt.Sprint(connectionId),
		MqttConnecting:   MQTT_CONNECTING + ":" + fmt.Sprint(connectionId),
		MqttReconnecting: MQTT_RECONNECTING + ":" + fmt.Sprint(connectionId),
		MqttMessages:     MQTT_MESSAGES + ":" + fmt.Sprint(connectionId),
		MqttClientError:  MQTT_CLIENT_ERROR + ":" + fmt.Sprint(connectionId),
		MqttLatency:      MQTT_CONNECTED_ROUNDTRIP_LATENCY + ":" + fmt.Sprint(connectionId),
		MqttClearHistory: MQTT_CLEAR_HISTORY + ":" + fmt.Sprint(connectionId),
	}
}
