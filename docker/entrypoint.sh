#!/bin/sh
# Entrypoint for the MQTT Viewer server-mode container.
#
# denisbrodbeck/machineid (called from backend/env's init) reads
# /etc/machine-id, falling back to /var/lib/dbus/machine-id, and PANICS if
# neither exists. The Dockerfile symlinks both onto /data/machine-id, so
# this script's only job is making sure that file exists before the app
# starts — creating it on first run against a fresh (empty) volume, and
# leaving it alone on every run after that. Keeping it in /data means it
# survives container recreation, which matters because saved broker
# passwords are encrypted with a key derived from the machine id: delete
# the file and those passwords stop decrypting.
set -eu

DATA_DIR="${MQTT_VIEWER_DATA_DIR:-/data}"
MACHINE_ID_FILE="$DATA_DIR/machine-id"

mkdir -p "$DATA_DIR" 2>/dev/null || true

if [ ! -w "$DATA_DIR" ]; then
    echo "entrypoint: WARNING: $DATA_DIR is not writable by uid:gid $(id -u):$(id -g)." >&2
    echo "entrypoint: if this is a bind-mounted host directory, fix it with: chown -R 1000:1000 <host-dir>" >&2
    echo "entrypoint: named Docker volumes are writable by default and do not need this." >&2
fi

if [ ! -s "$MACHINE_ID_FILE" ]; then
    # 32 lowercase hex chars, matching the shape of a real /etc/machine-id:
    # two kernel-random UUIDs with dashes stripped, concatenated and
    # truncated. /proc/sys/kernel/random/uuid is always present in a Linux
    # container, so no extra tooling is required.
    id_part1=$(tr -d '-' < /proc/sys/kernel/random/uuid)
    id_part2=$(tr -d '-' < /proc/sys/kernel/random/uuid)
    machine_id=$(printf '%s%s' "$id_part1" "$id_part2" | cut -c1-32)
    if ! printf '%s\n' "$machine_id" > "$MACHINE_ID_FILE" 2>/dev/null; then
        echo "entrypoint: ERROR: could not write $MACHINE_ID_FILE (see writability warning above)." >&2
        exit 1
    fi
    echo "entrypoint: generated new machine id at $MACHINE_ID_FILE" >&2
else
    echo "entrypoint: reusing existing machine id at $MACHINE_ID_FILE" >&2
fi

exec "$@"
