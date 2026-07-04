package app

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sync"

	"mqtt-viewer/backend/models"
	viewerEvents "mqtt-viewer/events"

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

// OpenTopicWindowParams carries the state needed to pop the selected-topic
// panel out into its own window: which connection it follows, and the topic
// selected at the moment of opening. The topic rides along in the URL so a
// freshly created window can seed itself: a TopicWindowSelect event emitted
// right after creation would be dropped by a webview whose JS runtime has
// not mounted yet.
type OpenTopicWindowParams struct {
	ConnectionID uint   `json:"connectionId"`
	Topic        string `json:"topic"`
}

var (
	topicWindowsMu sync.Mutex
	// keyed by connection id so repeat calls reuse the existing pop-out
	// rather than opening duplicates; unlike chart windows, only one topic
	// pop-out is meaningful per connection.
	topicWindows = map[uint]*application.WebviewWindow{}
)

// buildTopicWindowURL builds the route the detached topic window loads. Kept
// separate (and pure) so the encoding is unit-testable without a running app.
func buildTopicWindowURL(params OpenTopicWindowParams) string {
	query := url.Values{}
	query.Set("view", "topic")
	query.Set("conn", fmt.Sprint(params.ConnectionID))
	if params.Topic != "" {
		query.Set("topic", params.Topic)
	}
	return "/?" + query.Encode()
}

// OpenTopicWindow opens (or focuses) a separate window rendering the
// selected-topic panel for a connection, following topic selection in the
// main window like Chrome DevTools follows the page.
func (a *App) OpenTopicWindow(params OpenTopicWindowParams) error {
	wailsApp := application.Get()
	if wailsApp == nil {
		return fmt.Errorf("application not running")
	}

	// Hold the lock across the whole check-create-insert so two near-simultaneous
	// calls for the same connection can't both miss the map and open duplicate
	// windows (TOCTOU). Window creation here is a cheap, non-blocking call.
	topicWindowsMu.Lock()
	defer topicWindowsMu.Unlock()

	if existing, ok := topicWindows[params.ConnectionID]; ok && existing != nil {
		// Deliberately no Focus() here: this is called on every topic
		// selection while the mode is "window", and focusing would yank the
		// user away from the topic tree they are clicking in. Selection
		// changes reach the open window via TopicWindowSelect instead.
		return nil
	}

	windowURL := buildTopicWindowURL(params)

	window := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Selected topic",
		Width:            700,
		Height:           600,
		MinWidth:         400,
		MinHeight:        400,
		BackgroundColour: application.NewRGB(18, 18, 18),
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHiddenInset,
		},
		URL: windowURL,
	})
	topicWindows[params.ConnectionID] = window

	connectionID := params.ConnectionID
	window.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		topicWindowsMu.Lock()
		// Only remove our own entry: if the user reopened the pop-out (a new
		// window now occupies this key), deleting unconditionally would evict
		// the live window and break focus-or-create.
		if topicWindows[connectionID] == window {
			delete(topicWindows, connectionID)
		}
		topicWindowsMu.Unlock()

		if a.EventRuntime != nil {
			a.EventRuntime.EventsEmit(string(viewerEvents.TopicWindowClosed), connectionID)
		}

		// If the window closed by the user's own hand (not because we're
		// re-docking, which sets the mode away from "window" first), revert
		// dock mode back to wherever it was last docked. Doing the revert here
		// avoids depending on any particular window being alive to perform it.
		a.revertTopicPanelDockIfStillWindowed()
	})

	return nil
}

// closeAllTopicWindows closes every open topic pop-out window. Called when
// re-docking is chosen from a pop-out's own menu: the mode has already moved
// away from "window", so the WindowClosing handler above won't revert it
// again when these windows close.
func closeAllTopicWindows() {
	topicWindowsMu.Lock()
	windows := make([]*application.WebviewWindow, 0, len(topicWindows))
	for _, window := range topicWindows {
		windows = append(windows, window)
	}
	topicWindowsMu.Unlock()

	for _, window := range windows {
		window.Close()
	}
}

// revertTopicPanelDockIfStillWindowed sets the dock mode back to
// TopicPanelLastDockedSide when a topic pop-out window closes while the mode
// is still "window" (i.e. the user closed the window directly, rather than
// re-docking from its menu, which would have already changed the mode).
func (a *App) revertTopicPanelDockIfStillWindowed() {
	var settings models.AppSettings
	if err := a.Db.First(&settings, 1).Error; err != nil {
		return
	}
	if settings.TopicPanelDockMode != "window" {
		return
	}
	settings.TopicPanelDockMode = settings.TopicPanelLastDockedSide
	if err := a.Db.Save(&settings).Error; err != nil {
		return
	}
	if a.EventRuntime != nil {
		a.EventRuntime.EventsEmit(string(viewerEvents.TopicPanelDockChanged), TopicPanelDockChangedPayload{
			Mode:           settings.TopicPanelDockMode,
			LastDockedSide: settings.TopicPanelLastDockedSide,
		})
	}
}
