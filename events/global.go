package events

type GlobalEvent string

const (
	ConnectionDeleted GlobalEvent = "ConnectionDeleted"
	UpdateAvailable   GlobalEvent = "UpdateAvailable"
)

var GlobalEvents = []struct {
	Value  GlobalEvent
	TSName string
}{
	{ConnectionDeleted, "ConnectionDeleted"},
	{UpdateAvailable, "UpdateAvailable"},
}
