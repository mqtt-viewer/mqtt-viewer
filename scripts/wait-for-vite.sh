#!/bin/sh
# Block until the Vite dev server answers, so the app's webview never races the
# bind. Without this, wails3 dev can open the window before Vite is listening
# and the webview stays blank (View -> Reload does not recover it).
# Run as part of the dev_mode executes in build/config.yml, before wails3 task run.
set -eu

port="${WAILS_VITE_PORT:-9245}"
deadline=$(($(date +%s) + 60))

until curl -sf -o /dev/null "http://localhost:${port}/"; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "wait-for-vite: no response on http://localhost:${port}/ after 60s" >&2
    exit 1
  fi
  sleep 0.3
done
