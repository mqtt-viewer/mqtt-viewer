package eventRuntime

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type EventRuntime struct {
	ctx                 context.Context
	listenerCancelFuncs map[string]func()
}

func InitEventRuntime(ctx context.Context) *EventRuntime {
	return &EventRuntime{
		ctx:                 ctx,
		listenerCancelFuncs: map[string]func(){},
	}
}

func (e *EventRuntime) EventsEmit(
	eventName string,
	optionalData ...interface{},
) {
	application.Get().Event.Emit(eventName, optionalData...)
}

func (e *EventRuntime) EventsOn(
	eventName string,
	callback func(optionalData ...interface{}),
	key string,
) {
	cancelFunc := application.Get().Event.On(eventName, func(event *application.CustomEvent) {
		callback(event.Data)
	})
	e.listenerCancelFuncs[key] = cancelFunc
}

func (e *EventRuntime) EventsOff(
	eventName string,
	additionalEventNames ...string,
) {
	application.Get().Event.Off(eventName)
	for _, additionalEventName := range additionalEventNames {
		application.Get().Event.Off(additionalEventName)
	}
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
