#!/bin/sh
# Run the wails3 CLI built from the exact tag go.mod pins. The binding
# generator ships in the CLI, not the module, so a CLI from any other tag
# rewrites every file under frontend/bindings/. The pinned CLI is installed
# into a per-checkout, gitignored .bin/ on first use (and reinstalled when
# go.mod moves), so a global wails3 of another version never gets involved.
# Taskfile commands call `wails3` by name, so .bin also goes first on PATH.
#
# Usage:
#   scripts/wails3.sh <wails3 args>   # e.g. task -f common:generate:bindings
#   scripts/wails3.sh --install       # only make sure the pinned CLI is there
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
bin="$root/.bin"
module=github.com/wailsapp/wails/v3

pinned=$(cd "$root" && go list -m -f '{{.Version}}' "$module")
installed=$(go version -m "$bin/wails3" 2>/dev/null |
  awk -v m="$module" '$1 == "mod" && $2 == m { print $3 }')

if [ "$installed" != "$pinned" ]; then
  echo "installing wails3 $pinned into .bin/ (found: ${installed:-none})" >&2
  # Linux needs the gtk3 tag, matching the release and flatpak workflows.
  tags=
  [ "$(uname -s)" = Linux ] && tags="-tags gtk3"
  # shellcheck disable=SC2086
  GOBIN="$bin" go install $tags "$module/cmd/wails3@$pinned"
fi

[ "${1:-}" = --install ] && exit 0

PATH="$bin:$PATH"
export PATH
exec "$bin/wails3" "$@"
