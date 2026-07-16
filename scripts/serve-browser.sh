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
#   scripts/serve-browser.sh [port]        # default port 9500
#   SKIP_FRONTEND=1 scripts/serve-browser.sh   # reuse existing frontend/dist
#
# Then open http://localhost:<port> in a browser. Backend bindings work.
# NOTE: this is a headless instance running the real Go backend — it is NOT the
# native window. Backend->frontend live events need one extra script tag; see the
# AGENTS.md section for details.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd -P)
port="${1:-${WAILS_SERVER_PORT:-9500}}"
bin="$root/bin/mqtt-viewer-server"

cd "$root"

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  echo "Building frontend (set SKIP_FRONTEND=1 to reuse frontend/dist)..." >&2
  ( cd frontend && pnpm run build )
fi

echo "Building server-mode binary (-tags server)..." >&2
go build -tags server -o "$bin" .

echo "Serving on http://localhost:$port  (Ctrl+C to stop)" >&2
exec env WAILS_SERVER_PORT="$port" "$bin"
