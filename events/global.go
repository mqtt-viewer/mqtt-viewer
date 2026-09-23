package events

type GlobalEvent string

const (
	ConnectionDeleted     GlobalEvent = "ConnectionDeleted"
	UpdateAvailable       GlobalEvent = "UpdateAvailable"
	TopicWindowSelect     GlobalEvent = "TopicWindowSelect"
	TopicPanelDockChanged GlobalEvent = "TopicPanelDockChanged"
	PinnedTopicsChanged   GlobalEvent = "PinnedTopicsChanged"
)

// GlobalEventNames returns all global event names. It exists so the
// GlobalEvent enum is included in the generated frontend bindings.
func (e *ConnectionEvents) GlobalEventNames() []GlobalEvent {
	return []GlobalEvent{ConnectionDeleted, UpdateAvailable, TopicWindowSelect, TopicPanelDockChanged, PinnedTopicsChanged}
}
