package events

import "github.com/wailsapp/wails/v3/pkg/application"

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

func init() {
	application.RegisterEvent[uint](string(ConnectionDeleted))
	application.RegisterEvent[struct{}](string(UpdateAvailable))
}
