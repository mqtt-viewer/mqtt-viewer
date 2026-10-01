# Running multiple dev agents in parallel

Several agents (or humans) can build and test this app at the same time,
each in their own git worktree. This doc lists what is isolated, what is
shared, and the one setup step each checkout needs.

## Setup per checkout

```sh
just setup          # or scripts/setup-worktree.sh
```

A fresh worktree has none of the gitignored or per-clone pieces, so run
this once in each new checkout. It is idempotent: re-running it skips
what is already done and prints one line per step (`set`, `skip`, `ok`).
It exits non-zero with a `fail` line on a real failure. It does five
things:

- `pnpm install --frozen-lockfile` in `frontend/`.
- `scripts/.venv` with `paho-mqtt`, for `scripts/mqtt-sim.py` and
  `scripts/mqtt-flood.py`. If creating one fails (no `python3`, pip
  offline), it symlinks the main checkout's `scripts/.venv` instead,
  found via `git worktree list`.
- `scripts/dev-ports.sh write-launch` (below).
- The `frontend/dist` stub that `main.go` embeds (`just stub-dist`), so
  `go build ./...` works before a real frontend build.
- `git config core.hooksPath .githooks`, the pre-push guard on `main`.
  This is per clone, so every worktree shares it.

## Dev ports

`scripts/dev-ports.sh write-launch` writes `.claude/launch.json`
(gitignored) with dev-server ports derived from the checkout's absolute
path, so every worktree gets its own stable ports and none of them
collide:

- Vite / `wails3 dev`: 9300-9499
- Storybook: 6100-6299
- Server mode (`scripts/serve-browser.sh`): 9700-9899

`scripts/dev-ports.sh` prints all three; `scripts/dev-ports.sh server`
prints just the server-mode one. `just dev` and `scripts/serve-browser.sh`
pick the derived ports automatically. Override with `WAILS_VITE_PORT`,
`STORYBOOK_PORT` or `WAILS_SERVER_PORT` if a derived port is taken by
something else (`wails3 dev` and Storybook both fail fast on a busy port
rather than silently moving). `serve-browser.sh` also takes the port as
its first argument, and prints the URL it serves on.

Watch out: some older branches still track `.claude/launch.json`, so
checking one out and switching away deletes the file. If it goes
missing, re-run `just setup` or `scripts/dev-ports.sh write-launch`.

## What is already isolated per worktree

- Dev database: `_dev_resources/MqttViewer.db` resolves relative to the
  compiled source path (`backend/paths/paths.go`), so each worktree has its
  own.
- Build outputs: `bin/`, `.task/` checksums, `frontend/dist`,
  `frontend/bindings` are all per-checkout.
- Go build cache and the pnpm store are shared but concurrency-safe.

## What is shared

- The local test broker (`mqtt-test-broker` container on `localhost:1883`
  for mqtt and `localhost:9001` for websockets) and `test.mosquitto.org`.
  The Go tests in `backend/mqtt` and `backend/app` need it running; start
  it with `scripts/test-broker.sh up`. Fine to share, but prefix your test
  topics with something unique (for example the branch name) so parallel
  agents do not read each other's traffic.
- The user's installed `/Applications/MQTT Viewer.app`. Dev builds use the
  bundle id `com.mqttviewer.MQTTViewer.dev` (`build/darwin/Info.dev.plist`)
  so LaunchServices never confuses a dev build with the installed app.

## Blank webview on boot

`wails3 dev` gates the app launch on the Vite dev server actually answering
(`scripts/wait-for-vite.sh`, wired in `build/config.yml`). If the window
ever comes up blank, the dev server died: check the `wails3 dev` output.

## Known limits for GUI-driving the dev app

Synthetic clicks (computer-use) still do not route into a binary launched
directly from the shell, which is how `wails3 dev` starts the app. The
automated suite is the authoritative signal: `pnpm check`, `pnpm test:run`,
`pnpm build`, `pnpm ds:validate`, `pnpm test-storybook`, plus
`go build ./...` and `just test`.
