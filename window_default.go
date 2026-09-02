//go:build !server

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// createMainWindow opens the native webview window. Excluded from server-mode
// builds (scripts/serve-browser.sh): a headless window's runtime never signals
// ready, so wails would buffer every emitted event into the window's unbounded
// pendingJS slice for the life of the process.
func createMainWindow(wailsApp *application.App) {
	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "MQTT Viewer",
		Width:            900,
		Height:           700,
		MinWidth:         825,
		MinHeight:        660,
		BackgroundColour: application.NewRGB(35, 33, 32),
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHiddenInset,
		},
		URL: "/",
	})
}
