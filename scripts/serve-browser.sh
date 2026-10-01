#!/bin/sh
# Serve MQTT Viewer as a browser-drivable HTTP app (Wails v3 "server mode").
#
# Why this exists: a normal `wails3 dev` run serves `/wails/runtime` only inside
# the native webview's in-process URL-scheme handler. There is NO TCP socket for
# it, so an external browser (Chrome, Playwright, an agent) that loads the Vite
# dev port renders the UI but every binding/runtime call fails at
# runtimeCallWithID. See AGENTS.md > "Driving the app from a browser (agents)".
#
# Wails v3 alpha ships a supported headless "server mode" (build tag `server`)
# that runs a real HTTP server. It serves the built frontend and handles
# `/wails/runtime` over plain HTTP fetch — the exact transport the bundled
# @wailsio/runtime already uses — so binding calls round-trip from any browser.
# The production webview build never sees the `server` tag, so this is dev-only.
#
# Usage:
#   scripts/serve-browser.sh [port]        # default: derived per checkout
#   SKIP_FRONTEND=1 scripts/serve-browser.sh   # reuse existing frontend/dist
#
# The default port comes from `scripts/dev-ports.sh server` (9700-9899, stable
# per checkout) so parallel worktrees don't collide. An explicit [port] wins,
# then WAILS_SERVER_PORT. The script prints the URL before it starts serving.
# Then open that URL in a browser. Backend bindings work.
# NOTE: this is a headless instance running the real Go backend — it is NOT the
# native window. Backend->frontend live events need one extra script tag; see the
# AGENTS.md section for details.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd -P)
port="${1:-$("$root/scripts/dev-ports.sh" server)}"
bin="$root/bin/mqtt-viewer-server"

cd "$root"

echo "Will serve on http://localhost:$port once built" >&2

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  echo "Building frontend (set SKIP_FRONTEND=1 to reuse frontend/dist)..." >&2
  ( cd frontend && pnpm run build )
fi

echo "Building server-mode binary (-tags server)..." >&2
go build -tags server -o "$bin" .

# A server build resolves the production data directory, the same one the
# installed app uses, unless MQTT_VIEWER_DATA_DIR says otherwise. Default it to
# a per-checkout scratch directory so an agent driving this script never
# touches, or migrates, the real database.
data_dir="${MQTT_VIEWER_DATA_DIR:-$root/_dev_resources/server}"
mkdir -p "$data_dir"

echo "Serving on http://localhost:$port  (Ctrl+C to stop), data in $data_dir" >&2
exec env WAILS_SERVER_PORT="$port" MQTT_VIEWER_DATA_DIR="$data_dir" "$bin"
