package mqtt

type ConnectionState string

type connectionStates struct {
	Disconnected ConnectionState
	Connecting   ConnectionState
	Connected    ConnectionState
	Reconnecting ConnectionState
}

var ConnectionStates = connectionStates{
	Disconnected: "disconnected",
	Connecting:   "connecting",
	Connected:    "connected",
	Reconnecting: "reconnecting",
}
