package main

import (
	"embed"
	"log/slog"
	"mqtt-viewer/backend/app"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/events"
	"net/http"
	"os"
	"strings"

	"github.com/mitchellh/panicwrap"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// panicwrap re-executes the binary and watches the child for panics, which
	// feeds the desktop crash reporter. Server builds skip it: the container
	// already captures stderr, and the wrapper parent runs as PID 1 without
	// forwarding signals, so SIGTERM from `docker stop` would never reach the
	// app and Wails' own graceful shutdown would never run.
	if !env.IsDev && !env.IsServerBuild {
		exitStatus, err := panicwrap.BasicWrap(panicHandler)
		if err != nil {
			// Something went wrong setting up the panic wrapper. Unlikely,
			// but possible.
			panic(err)
		}

		// If exitStatus >= 0, then we're the parent process and the panicwrap
		// re-executed ourselves and completed. Just exit with the proper status.
		if exitStatus >= 0 {
			os.Exit(exitStatus)
		}
	}

	mqttViewer := app.NewApp(app.AppModes.Wails, env.Version)
	connectionEvents := events.NewConnectionEvents()

	assetOptions := application.AssetOptions{
		Handler: application.AssetFileServerFS(assets),
	}
	if env.IsServerBuild {
		assetOptions.Middleware = guardRuntimeOrigin
	}

	wailsApp := application.New(application.Options{
		Name:        "MQTT Viewer",
		Description: "A fast and feature-rich MQTT visualization and debugging tool",
		Services: []application.Service{
			application.NewService(mqttViewer),
			application.NewService(connectionEvents),
		},
		Assets: assetOptions,
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	createMainWindow(wailsApp)

	err := wailsApp.Run()

	// Server mode returns from Run when Wails' own SIGTERM/SIGINT handler has
	// drained the HTTP server, which is where `docker stop` lands. Wails' Quit
	// path (and the shutdown hooks that hang off it) is never reached that way,
	// and its logger is discarded under -tags production, so do the last of the
	// work here: say so in the container log, and close the broker connections
	// properly. Without the second part the broker only sees a dropped socket
	// and fires the last will on every restart.
	if env.IsServerBuild {
		slog.Info("shutting down, disconnecting mqtt clients")
		for id := range mqttViewer.GetAllConnections().Connections {
			_ = mqttViewer.DisconnectMqtt(id)
		}
		slog.Info("shutdown complete")
	}

	if err != nil {
		slog.Error(err.Error())
		panic(err)
	}
}

// guardRuntimeOrigin rejects cross-origin requests to /wails/runtime, the HTTP
// endpoint that executes bound Go methods. Server mode serves the app to a real
// browser, where any page the user visits can reach that endpoint with a form
// POST or a query-string GET, neither of which triggers a CORS preflight. Left
// open, a malicious page could publish messages, delete connections or clear
// retained messages on the user's behalf.
//
// Only /wails/runtime is gated. Assets are harmless, and the /wails/events
// WebSocket is routed by Wails ahead of the asset chain so this middleware never
// sees it; that residual risk is documented in docs/DOCKER.md.
func guardRuntimeOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/wails/runtime" {
			next.ServeHTTP(w, r)
			return
		}
		// Sec-Fetch-Site is the reliable signal and every current browser sends
		// it: "same-origin" is our own page, "none" is a typed-in URL. Clients
		// that send neither this nor Origin (curl, scripts, health probes) are
		// not browsers and are left alone.
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
			http.Error(w, "cross-origin request rejected", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && !originMatchesHost(origin, r.Host) {
			http.Error(w, "cross-origin request rejected", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// originMatchesHost compares an Origin header with the Host the request arrived
// on, ignoring the scheme so a TLS-terminating reverse proxy forwarding plain
// HTTP still matches.
func originMatchesHost(origin string, host string) bool {
	if i := strings.Index(origin, "://"); i >= 0 {
		origin = origin[i+3:]
	}
	return strings.EqualFold(origin, host)
}

func panicHandler(output string) {
	slog.Error("panic occurred")
	slog.Error(output)
	os.Exit(1)
}
