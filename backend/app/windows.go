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
			Width:            900,
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
	// Pop-outs being closed programmatically because their connection went
	// away (deleted, or its tab closed). Their WindowClosing handler must
	// skip the dock-mode revert: the user didn't close them, and "window"
	// mode should keep applying to other connections.
	topicWindowsSilentClose = map[*application.WebviewWindow]struct{}{}
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

	// Title by connection name, matching the broker-status window precedent,
	// so pop-outs for different connections are tellable apart in the window
	// list.
	title := "Selected topic"
	connection := models.Connection{}
	if err := a.Db.First(&connection, params.ConnectionID).Error; err == nil && connection.Name != "" {
		title = "Selected topic - " + connection.Name
	}

	window := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            title,
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
		_, silent := topicWindowsSilentClose[window]
		delete(topicWindowsSilentClose, window)
		// Only remove our own entry: if the user reopened the pop-out (a new
		// window now occupies this key), deleting unconditionally would evict
		// the live window and break focus-or-create.
		if topicWindows[connectionID] == window {
			delete(topicWindows, connectionID)
		}
		topicWindowsMu.Unlock()

		// On quit Wails' cleanup closes every window; reverting there would
		// wipe a deliberate "window" mode before the next launch (and the DB
		// write would race shutdown). The OnShutdown hook flips the flag
		// before cleanup closes any window, so this is a reliable quit
		// signal. Silent closes (connection deleted, tab closed) skip the
		// revert for the same reason: the user didn't close the window.
		if silent || a.shuttingDown.Load() {
			return
		}

		// If the window closed by the user's own hand (not because we're
		// re-docking, which sets the mode away from "window" first), revert
		// dock mode back to wherever it was last docked. Doing the revert here
		// avoids depending on any particular window being alive to perform it.
		a.revertTopicPanelDockIfStillWindowed()
	})

	return nil
}

// FocusTopicWindow focuses the connection's topic pop-out if one is open, and
// opens one otherwise. Used by the main window's "window" mode affordance;
// unlike OpenTopicWindow it always brings the pop-out to the front.
func (a *App) FocusTopicWindow(params OpenTopicWindowParams) error {
	topicWindowsMu.Lock()
	existing := topicWindows[params.ConnectionID]
	topicWindowsMu.Unlock()
	if existing != nil {
		existing.Focus()
		return nil
	}
	return a.OpenTopicWindow(params)
}

// closeTopicWindowForConnection closes the connection's topic pop-out (if any)
// without reverting the dock mode: used when the connection is deleted, where
// "window" mode should keep applying to other connections. Safe to call when
// no Wails app is running (the registry is empty in tests).
func closeTopicWindowForConnection(connectionID uint) {
	topicWindowsMu.Lock()
	window := topicWindows[connectionID]
	if window != nil {
		topicWindowsSilentClose[window] = struct{}{}
	}
	topicWindowsMu.Unlock()
	if window != nil {
		window.Close()
	}
}

// closeTopicWindowsNotIn closes pop-outs whose connection is not in the open
// set. Called from UpdateOpenConnectionTabs so a closed tab takes its pop-out
// with it, whichever UI path closed the tab; adds and reorders pass their
// full open list and so close nothing.
func closeTopicWindowsNotIn(openConnIds []uint) {
	open := make(map[uint]struct{}, len(openConnIds))
	for _, id := range openConnIds {
		open[id] = struct{}{}
	}

	topicWindowsMu.Lock()
	toClose := []*application.WebviewWindow{}
	for connId, window := range topicWindows {
		if _, isOpen := open[connId]; !isOpen && window != nil {
			topicWindowsSilentClose[window] = struct{}{}
			toClose = append(toClose, window)
		}
	}
	topicWindowsMu.Unlock()

	for _, window := range toClose {
		window.Close()
	}
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
	// The mode is no longer "window", so any other connection's pop-outs are
	// now orphans: nothing follows selection into them and nothing else will
	// close them. Their WindowClosing handlers re-enter the revert, which
	// no-ops on the mode check above.
	closeAllTopicWindows()
	if a.EventRuntime != nil {
		a.EventRuntime.EventsEmit(string(viewerEvents.TopicPanelDockChanged), TopicPanelDockChangedPayload{
			Mode:           settings.TopicPanelDockMode,
			LastDockedSide: settings.TopicPanelLastDockedSide,
		})
	}
}
