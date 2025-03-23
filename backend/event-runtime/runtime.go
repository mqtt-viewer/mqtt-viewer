package eventRuntime

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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
	runtime.EventsEmit(e.ctx, eventName, optionalData...)
}

func (e *EventRuntime) EventsOn(
	eventName string,
	callback func(optionalData ...interface{}),
	key string,
) {
	cancelFunc := runtime.EventsOn(e.ctx, eventName, callback)
	e.listenerCancelFuncs[key] = cancelFunc
}

func (e *EventRuntime) EventsOff(
	eventName string,
	additionalEventNames ...string,
) {
	runtime.EventsOff(e.ctx, eventName, additionalEventNames...)
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
