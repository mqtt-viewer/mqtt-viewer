#!/bin/sh
# Start (or stop) the shared local test broker the Go tests expect:
# an eclipse-mosquitto container named mqtt-test-broker listening on
# localhost:1883 (mqtt) and localhost:9001 (websockets), anonymous auth.
# Shared across worktrees, so it is safe to leave running.
#
# Usage:
#   scripts/test-broker.sh up      # create/start the container
#   scripts/test-broker.sh down    # stop and remove it
#   scripts/test-broker.sh status  # show whether it is running
set -eu

name=mqtt-test-broker
conf_dir="${TMPDIR:-/tmp}/$name"

up() {
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then
    echo "$name already running"
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
    echo "$name started"
    return
  fi
  mkdir -p "$conf_dir"
  cat >"$conf_dir/mosquitto.conf" <<'EOF'
listener 1883
allow_anonymous true

listener 9001
protocol websockets
allow_anonymous true
EOF
  docker run -d --name "$name" \
    -p 1883:1883 -p 9001:9001 \
    -v "$conf_dir/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
    eclipse-mosquitto >/dev/null
  echo "$name created and started"
}

case "${1:-up}" in
  up) up ;;
  down) docker rm -f "$name" >/dev/null 2>&1 && echo "$name removed" || echo "$name not found" ;;
  status) docker ps --filter "name=$name" ;;
  *) echo "usage: $0 [up|down|status]" >&2; exit 1 ;;
esac
