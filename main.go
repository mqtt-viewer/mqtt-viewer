package main

import (
	"embed"
	"log/slog"
	"mqtt-viewer/backend/app"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/events"
	"os"

	"github.com/mitchellh/panicwrap"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if !env.IsDev {
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

	viewerApp := app.NewApp(app.AppModes.Wails, env.Version)
	connectionEvents := events.NewConnectionEvents()
	wailsApp := application.New(application.Options{
		Name:        "MQTT Viewer",
		Description: "A fast and feature-rich MQTT visualization and debugging tool",
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(assets),
		},
		Services: []application.Service{
			application.NewService(viewerApp),
			application.NewService(connectionEvents),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "MQTT Viewer",
		Width:            900,
		Height:           700,
		MinWidth:         825,
		MinHeight:        660,
		BackgroundColour: application.NewRGBA(35, 33, 32, 1),
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHiddenInset,
		},
	})
	err := wailsApp.Run()

	if err != nil {
		slog.Error(err.Error())
		panic(err)
	}
}

func panicHandler(output string) {
	slog.Error("panic occurred")
	slog.Error(output)
	os.Exit(1)
}
