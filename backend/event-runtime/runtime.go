package eventRuntime

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

type EventRuntime struct {
	app                 *application.App
	listenerCancelFuncs map[string]func()
}

func InitEventRuntime(app *application.App) *EventRuntime {
	return &EventRuntime{
		app:                 app,
		listenerCancelFuncs: map[string]func(){},
	}
}

func (e *EventRuntime) EventsEmit(
	eventName string,
	optionalData ...interface{},
) {
	e.app.Event.Emit(eventName, optionalData...)
}

func (e *EventRuntime) EventsOn(
	eventName string,
	callback func(optionalData ...interface{}),
	key string,
) {
	cancelFunc := e.app.Event.On(eventName, func(event *application.CustomEvent) {
		if event.Data == nil {
			callback()
			return
		}
		callback(event.Data)
	})
	e.listenerCancelFuncs[key] = cancelFunc
}

func (e *EventRuntime) EventsOff(
	eventName string,
) {
	e.app.Event.Off(eventName)
}

func (e *EventRuntime) EventsOffKey(
	key string,
) {
	cancelFunc := e.listenerCancelFuncs[key]
	if cancelFunc != nil {
		cancelFunc()
		delete(e.listenerCancelFuncs, key)
	}
}
