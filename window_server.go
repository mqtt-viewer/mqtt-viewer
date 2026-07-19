//go:build server

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// createMainWindow is a no-op in server mode: browser clients connect over
// HTTP/WebSocket and get per-client BrowserWindow objects from the broadcaster
// instead of a native window. See window_default.go for why creating one here
// would leak.
func createMainWindow(_ *application.App) {}
