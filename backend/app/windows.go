package app

import (
	"encoding/json"
	"fmt"
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

// OpenChartWindow opens (or focuses) a separate window rendering the standalone
// chart for a topic. The new window shares this Go backend and its event
// stream, so it live-updates from the same messages as the main window.
func (a *App) OpenChartWindow(params OpenChartWindowParams) error {
	wailsApp := application.Get()
	if wailsApp == nil {
		return fmt.Errorf("application not running")
	}
	key := chartWindowKey(params.ConnectionID, params.Topic)

	chartWindowsMu.Lock()
	if existing, ok := chartWindows[key]; ok && existing != nil {
		chartWindowsMu.Unlock()
		existing.Focus()
		return nil
	}
	chartWindowsMu.Unlock()

	query := url.Values{}
	query.Set("view", "chart")
	query.Set("conn", fmt.Sprint(params.ConnectionID))
	query.Set("topic", params.Topic)
	if len(params.Fields) > 0 {
		if encoded, err := json.Marshal(params.Fields); err == nil {
			query.Set("fields", string(encoded))
		}
	}
	windowURL := "/?" + query.Encode()

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

	chartWindowsMu.Lock()
	chartWindows[key] = window
	chartWindowsMu.Unlock()

	window.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		chartWindowsMu.Lock()
		delete(chartWindows, key)
		chartWindowsMu.Unlock()
	})

	return nil
}
