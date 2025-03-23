package mqtt

import "fmt"

type Middleware[onObject any] struct {
	ID   string
	Func func(params *onObject) error
}

type MqttMiddlewares struct {
	BeforePublish      []Middleware[MqttPublishParams]
	AfterPublish       []Middleware[MqttPublishParams]
	BeforeAddToHistory []Middleware[MqttMessage]
	AfterAddToHistory  []Middleware[MqttMessage]
}

func newMiddleware() *MqttMiddlewares {
	return &MqttMiddlewares{
		BeforePublish:      []Middleware[MqttPublishParams]{},
		AfterPublish:       []Middleware[MqttPublishParams]{},
		BeforeAddToHistory: []Middleware[MqttMessage]{},
		AfterAddToHistory:  []Middleware[MqttMessage]{},
	}
}

func (mm *MqttManager) useBeforePublish(middleware Middleware[MqttPublishParams]) {
	mm.middleware.BeforePublish = append(mm.middleware.BeforePublish, middleware)
}

func (mm *MqttManager) useAfterPublish(middleware Middleware[MqttPublishParams]) {
	mm.middleware.AfterPublish = append(mm.middleware.AfterPublish, middleware)
}

func (mm *MqttManager) useBeforeAddToHistory(middleware Middleware[MqttMessage]) {
	mm.middleware.BeforeAddToHistory = append(mm.middleware.BeforeAddToHistory, middleware)
}

func (mm *MqttManager) useAfterAddToHistory(middleware Middleware[MqttMessage]) {
	mm.middleware.AfterAddToHistory = append(mm.middleware.AfterAddToHistory, middleware)
}

func (mm *MqttManager) removeBeforePublish(id string) {
	for i, middleware := range mm.middleware.BeforePublish {
		if middleware.ID == id {
			mm.middleware.BeforePublish = append(mm.middleware.BeforePublish[:i], mm.middleware.BeforePublish[i+1:]...)
			return
		}
	}
}

func (mm *MqttManager) removeAfterPublish(id string) {
	for i, middleware := range mm.middleware.AfterPublish {
		if middleware.ID == id {
			mm.middleware.AfterPublish = append(mm.middleware.AfterPublish[:i], mm.middleware.AfterPublish[i+1:]...)
			return
		}
	}
}

func (mm *MqttManager) removeBeforeAddToHistory(id string) {
	for i, middleware := range mm.middleware.BeforeAddToHistory {
		if middleware.ID == id {
			mm.middleware.BeforeAddToHistory = append(mm.middleware.BeforeAddToHistory[:i], mm.middleware.BeforeAddToHistory[i+1:]...)
			return
		}
	}
}

func (mm *MqttManager) removeAfterAddToHistory(id string) {
	for i, middleware := range mm.middleware.AfterAddToHistory {
		if middleware.ID == id {
			mm.middleware.AfterAddToHistory = append(mm.middleware.AfterAddToHistory[:i], mm.middleware.AfterAddToHistory[i+1:]...)
			return
		}
	}
}

func handlePublishMiddleware(publish *MqttPublishParams, publishMiddleware []Middleware[MqttPublishParams]) error {
	for _, middleware := range publishMiddleware {
		err := middleware.Func(publish)
		if err != nil {
			return newMiddlewareError("publish", err)
		}
	}
	return nil
}

func handleReceiveMiddleware(message *MqttMessage, recMiddleware []Middleware[MqttMessage]) error {
	for _, middleware := range recMiddleware {
		err := middleware.Func(message)
		if err != nil {
			return newMiddlewareError("receive", err)
		}
	}
	return nil
}

func newMiddlewareError(at string, err error) error {
	return fmt.Errorf("%s middleware error: %w", at, err)
}
