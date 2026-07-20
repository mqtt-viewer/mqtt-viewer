package events

type GlobalEvent string

const (
	ConnectionDeleted     GlobalEvent = "ConnectionDeleted"
	UpdateAvailable       GlobalEvent = "UpdateAvailable"
	TopicWindowSelect     GlobalEvent = "TopicWindowSelect"
	TopicWindowClosed     GlobalEvent = "TopicWindowClosed"
	TopicPanelDockChanged GlobalEvent = "TopicPanelDockChanged"
)

// GlobalEventNames returns all global event names. It exists so the
// GlobalEvent enum is included in the generated frontend bindings.
func (e *ConnectionEvents) GlobalEventNames() []GlobalEvent {
	return []GlobalEvent{ConnectionDeleted, UpdateAvailable, TopicWindowSelect, TopicWindowClosed, TopicPanelDockChanged}
}
