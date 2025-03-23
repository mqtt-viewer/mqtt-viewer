package main

import (
	"context"
	"embed"
	"log/slog"
	"mqtt-viewer/backend/app"
	"mqtt-viewer/backend/env"
	"mqtt-viewer/events"
	"os"

	"github.com/mitchellh/panicwrap"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
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

	app := app.NewApp(app.AppModes.Wails, env.Version)
	connectionEvents := events.NewConnectionEvents()
	err := wails.Run(&options.App{
		Title:     "MQTT Viewer",
		Width:     900,
		Height:    700,
		MinWidth:  825,
		MinHeight: 660,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 35, G: 33, B: 32, A: 1},
		OnStartup: func(ctx context.Context) {
			app.Startup(ctx, nil)
		},
		Bind: []interface{}{
			app,
			connectionEvents,
		},
		EnumBind: []interface{}{
			events.GlobalEvents,
		},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
		},
	},
	)

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
