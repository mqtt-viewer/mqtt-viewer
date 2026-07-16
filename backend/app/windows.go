package app

import (
	"encoding/json"
	"fmt"
	"mqtt-viewer/backend/models"
	"net/url"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// OpenChartWindowParams carries the state needed to render a detached chart:
// which connection + topic, and the numeric field paths to plot.
type OpenChartWindowParams struct {
	ConnectionID uint     `json:"connectionId"`
	Topic        string   `json:"topic"`
	Fields       []string `json:"fields"`
}

var (
	chartWindowsMu sync.Mutex
	// keyed by "<connId>|<topic>" so we focus an existing chart window rather
	// than opening duplicates.
	chartWindows = map[string]*application.WebviewWindow{}
)

func chartWindowKey(connectionID uint, topic string) string {
	return fmt.Sprintf("%d|%s", connectionID, topic)
}

// focusOrCreateWindow focuses an existing window registered under key, or builds
// and registers a new one. The lock is held across the whole check-create-insert
// so two near-simultaneous calls for the same key can't both miss the map and
// open duplicate windows (TOCTOU); window creation here is a cheap, non-blocking
// call. On close, the window removes only its own registry entry — if the user
// reopened (a new window now occupies this key), deleting unconditionally would
// evict the live window and break focus-or-create.
func focusOrCreateWindow[K comparable](
	mu *sync.Mutex,
	registry map[K]*application.WebviewWindow,
	key K,
	buildOptions func() application.WebviewWindowOptions,
) error {
	wailsApp := application.Get()
	if wailsApp == nil {
		return fmt.Errorf("application not running")
	}

	mu.Lock()
	defer mu.Unlock()

	if existing, ok := registry[key]; ok && existing != nil {
		existing.Focus()
		return nil
	}

	window := wailsApp.Window.NewWithOptions(buildOptions())
	registry[key] = window

	window.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		mu.Lock()
		defer mu.Unlock()
		if registry[key] == window {
			delete(registry, key)
		}
	})

	return nil
}

// buildChartWindowURL builds the route the detached chart window loads. Kept
// separate (and pure) so the encoding is unit-testable without a running app.
func buildChartWindowURL(params OpenChartWindowParams) string {
	query := url.Values{}
	query.Set("view", "chart")
	query.Set("conn", fmt.Sprint(params.ConnectionID))
	query.Set("topic", params.Topic)
	if len(params.Fields) > 0 {
		if encoded, err := json.Marshal(params.Fields); err == nil {
			query.Set("fields", string(encoded))
		}
	}
	return "/?" + query.Encode()
}

// OpenChartWindow opens (or focuses) a separate window rendering the standalone
// chart for a topic. The new window shares this Go backend and its event
// stream, so it live-updates from the same messages as the main window.
func (a *App) OpenChartWindow(params OpenChartWindowParams) error {
	key := chartWindowKey(params.ConnectionID, params.Topic)
	return focusOrCreateWindow(&chartWindowsMu, chartWindows, key, func() application.WebviewWindowOptions {
		return application.WebviewWindowOptions{
			Title:            params.Topic + " — chart",
			Width:            900,
			Height:           520,
			MinWidth:         500,
			MinHeight:        340,
			BackgroundColour: application.NewRGB(18, 18, 18),
			Mac: application.MacWindow{
				TitleBar: application.MacTitleBarHiddenInset,
			},
			URL: buildChartWindowURL(params),
		}
	})
}

var (
	statusWindowsMu sync.Mutex
	// keyed by connection id so we focus an existing broker-status window
	// rather than opening duplicates.
	statusWindows = map[uint]*application.WebviewWindow{}
)

// buildStatusWindowURL builds the route the broker-status window loads. Kept
// separate (and pure) so the encoding is unit-testable without a running app.
func buildStatusWindowURL(connectionID uint) string {
	query := url.Values{}
	query.Set("view", "status")
	query.Set("conn", fmt.Sprint(connectionID))
	return "/?" + query.Encode()
}

// OpenBrokerStatusWindow opens (or focuses) the detached broker-status window
// for a connection. The new window shares this Go backend and its event
// stream, so it live-updates from the same messages as the main window.
func (a *App) OpenBrokerStatusWindow(connectionId uint) error {
	title := "Broker status"
	connection := models.Connection{}
	if err := a.Db.First(&connection, connectionId).Error; err == nil && connection.Name != "" {
		title = connection.Name + " broker status"
	}

	return focusOrCreateWindow(&statusWindowsMu, statusWindows, connectionId, func() application.WebviewWindowOptions {
		return application.WebviewWindowOptions{
			Title:            title,
			Width:            760,
			Height:           560,
			MinWidth:         520,
			MinHeight:        380,
			BackgroundColour: application.NewRGB(18, 18, 18),
			Mac: application.MacWindow{
				TitleBar: application.MacTitleBarHiddenInset,
			},
			URL: buildStatusWindowURL(connectionId),
		}
	})
}
