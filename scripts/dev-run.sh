#!/bin/sh
# Dev entrypoint for the wails3 dev `primary` execute (see build/config.yml).
# It gates on the Vite dev server being up, then launches the app.
#
# This must be a single wrapper rather than `wait-for-vite.sh && wails3 task run`
# in build/config.yml: wails3 splits each execute `cmd` into argv on whitespace
# and does not run it through a shell, so a `&&` (or any shell operator/quote) is
# passed through as literal arguments and the launch never runs. Keeping the
# sequence here means the config `cmd` stays a single plain command.
set -eu

dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

sh "$dir/scripts/wait-for-vite.sh"
exec wails3 task run
