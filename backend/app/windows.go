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
	wailsApp := application.Get()
	if wailsApp == nil {
		return fmt.Errorf("application not running")
	}
	key := chartWindowKey(params.ConnectionID, params.Topic)

	// Hold the lock across the whole check-create-insert so two near-simultaneous
	// calls for the same topic can't both miss the map and open duplicate
	// windows (TOCTOU). Window creation here is a cheap, non-blocking call.
	chartWindowsMu.Lock()
	defer chartWindowsMu.Unlock()

	if existing, ok := chartWindows[key]; ok && existing != nil {
		existing.Focus()
		return nil
	}

	windowURL := buildChartWindowURL(params)

	title := params.Topic + " — chart"
	window := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            title,
		Width:            900,
		Height:           520,
		MinWidth:         500,
		MinHeight:        340,
		BackgroundColour: application.NewRGB(18, 18, 18),
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHiddenInset,
		},
		URL: windowURL,
	})
	chartWindows[key] = window

	window.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		chartWindowsMu.Lock()
		defer chartWindowsMu.Unlock()
		// Only remove our own entry: if the user reopened the chart (a new
		// window now occupies this key), deleting unconditionally would evict
		// the live window and break focus-or-create.
		if chartWindows[key] == window {
			delete(chartWindows, key)
		}
	})

	return nil
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
	wailsApp := application.Get()
	if wailsApp == nil {
		return fmt.Errorf("application not running")
	}

	// Hold the lock across the whole check-create-insert so two
	// near-simultaneous calls for the same connection can't both miss the map
	// and open duplicate windows (TOCTOU).
	statusWindowsMu.Lock()
	defer statusWindowsMu.Unlock()

	if existing, ok := statusWindows[connectionId]; ok && existing != nil {
		existing.Focus()
		return nil
	}

	title := "Broker status"
	connection := models.Connection{}
	if err := a.Db.First(&connection, connectionId).Error; err == nil && connection.Name != "" {
		title = connection.Name + " — broker status"
	}

	window := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
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
	})
	statusWindows[connectionId] = window

	window.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		statusWindowsMu.Lock()
		defer statusWindowsMu.Unlock()
		// Only remove our own entry (see OpenChartWindow cleanup note).
		if statusWindows[connectionId] == window {
			delete(statusWindows, connectionId)
		}
	})

	return nil
}
