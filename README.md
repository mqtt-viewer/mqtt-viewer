# MQTT Viewer

[MQTT Viewer](https://mqttviewer.app) is a feature-rich and performant MQTT visualisation and debugging tool for Windows, Mac and Linux.

[Download MQTT Viewer](https://github.com/mqtt-viewer/mqtt-viewer/releases)

![Screenshot of MQTT Viewer](docs/images/screenshot.png)

## Features

First and foremost, MQTT Viewer is fast, responsive and easy to use.

But wait, there's more:

| Feature                                  | Status | Comments                                                                                                                                                                                                     |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Topic tree data visualisation            | ✅     |                                                                                                                                                                                                              |
| MQTT v3 + v5 compatibility               | ✅     |                                                                                                                                                                                                              |
| Run multiple concurrent connections      | ✅     |                                                                                                                                                                                                              |
| Message publishing (+ v5 headers)        | ✅     |                                                                                                                                                                                                              |
| Interactive message timeline             | ✅     |                                                                                                                                                                                                              |
| Message comparison                       | ✅     | Currently only compares to previous message but I'm planning on making this more flexible.                                                                                                                   |
| Live topic charting                      | ✅     | ⭐ New! Chart numeric payload fields over time, with a pop-out chart window.                                                                                                                                 |
| Saved message collections                | ✅     | ⭐ New! Save messages per connection or globally and republish them with a click.                                                                                                                            |
| Bounded memory usage                     | ✅     | ⭐ New! Message history stays within a configurable memory budget, with opt-in recording to disk.                                                                                                            |
| Image payload previews                   | ✅     | ⭐ New! PNG, JPEG, GIF, WebP and BMP payloads render as images.                                                                                                                                              |
| Sparkplug + Base64 + Hex codecs          | ✅     |                                                                                                                                                                                                              |
| Free-text / pattern-based filters        | ✅     |                                                                                                                                                                                                              |
| Publish history                          | ✅     |                                                                                                                                                                                                              |
| Client logs                              | 🚧     | In progress                                                                                                                                                                                                  |
| Broker status page (based on $SYS data)  | ❓     | Potential. Let me know if you might use this [here](https://github.com/mqtt-viewer/mqtt-viewer/discussions/1).                                                                                               |
| In-app local test broker                 | ❓     | Potential. This would be an alternative to running a local mosquitto instance for debugging/development. Let me know if you might use this [here](https://github.com/mqtt-viewer/mqtt-viewer/discussions/2). |
| Team workspaces + cloud collections sync | ❓     | Potential. Let me know if you might use this [here](https://github.com/mqtt-viewer/mqtt-viewer/discussions/3).                                                                                               |

Don't see a feature that would make your life easier? [I really, really want to know.](https://github.com/mqtt-viewer/mqtt-viewer/issues/new?template=feature_idea.yml)

## Contributing

If MQTT Viewer has been helpful, right now the best ways to contribute are:

- Reporting bugs and making feature requests via [GitHub issues](https://github.com/mqtt-viewer/mqtt-viewer/issues)
- Contributing to the codebase by solving bugs or implementing new features. If you're interested in contributing in this way, please [read the contributing guide](CONTRIBUTING.md) first and then choose an issue to work on!
- Giving me honest, constructive feedback about what you like and don't like about MQTT Viewer via [GitHub discussions](https://github.com/mqtt-viewer/mqtt-viewer/discussions).
- Seriously, nothing is too big or too small. [Let me know](https://github.com/mqtt-viewer/mqtt-viewer/issues) how to make MQTT Viewer better for you.
- Letting others know about MQTT Viewer on your favourite social media or blogs.
- Leaving MQTT Viewer [a testimonal!](https://testimonial.to/mqtt-viewer/)

## Development

MQTT Viewer is built using [Wails](https://wails.io/), a Go-based application framework, and [Svelte](https://svelte.dev/).

### Prerequisites

- [Go](https://golang.org/doc/install)
- [Node.js](https://nodejs.org/en/download/)
- [Wails v3](https://v3.wails.io/quick-start/installation/) (install via `go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha.98-tui`, matching the version pinned in go.mod)
- [pnpm](https://pnpm.io/installation) (install via `npm install -g pnpm`)
- [Just](https://github.com/casey/just?tab=readme-ov-file#cross-platform) - optional, but recommended for running commands in the project
- [Atlas](https://github.com/ariga/atlas) - optional, only necessary if you need to create database migrations

### Setup

1. Clone the repository with `git clone https://github.com/mqtt-viewer/mqtt-viewer`
2. Navigate to the project directory with `cd mqtt-viewer`
3. Install the Go dependencies with `go mod tidy`
4. Navigate to the frontend directory with `cd frontend`
5. Install the Node.js dependencies with `pnpm install`
6. Navigate back to the root directory with `cd ..`
7. Run the application with `just dev` (or `wails3 dev` if you don't use Just)

If there are problems with Wails, try running `wails3 doctor` to check your installation.

Please open an issue if you have any problems.

### Common commands

From the repository root:

```sh
just dev                 # run the app with hot reload
just test                # run the Go tests
just build               # package the app for your platform
just new-migration NAME  # create a database migration (requires Atlas)
```

From the `frontend/` directory:

```sh
pnpm check          # svelte-check, keep at 0 errors
pnpm test:run       # vitest unit tests
pnpm storybook      # component library on port 6006
pnpm ds:validate    # design-system validation (run by CI)
pnpm test-storybook # Storybook interaction tests
```

`just dev` derives its dev-server port from the checkout path so parallel
checkouts don't collide. See `docs/MULTI_AGENT_DEV.md` if you need to
override it.

### Hot Reloading

Changes to the frontend code will automatically trigger a rebuild and reload the application quickly.

This may cause some issues if the frontend and backend are now out of sync. If so, just restart the application.

Changes to the Go code will trigger a full rebuild which may take anywhere from a few seconds to a minute depending on your hardware specs.

## License

MQTT Viewer is open-source under [GPL-3.0-or-later](https://www.gnu.org/licenses/gpl-3.0.html).

All features are free to use.
