#!/bin/sh
# Make a checkout (usually a fresh agent worktree) ready to work in. Everything
# here is gitignored or per-clone, so a new worktree starts without it:
#
#   - frontend/node_modules     pnpm install --frozen-lockfile
#   - scripts/.venv             python venv with paho-mqtt for mqtt-sim.py and
#                               mqtt-flood.py; falls back to a symlink to the
#                               main checkout's venv if creating one fails
#   - .claude/launch.json       scripts/dev-ports.sh write-launch
#   - frontend/dist stub        same as `just stub-dist`, so go build works
#   - core.hooksPath            .githooks (the pre-push guard on main)
#
# Idempotent: safe to re-run, and steps that are already done are skipped.
# Prints one line per step. Exits non-zero on the first real failure.
#
# Usage:
#   scripts/setup-worktree.sh        # or: just setup
set -eu

root=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$root"

say() { printf '%-6s %s\n' "$1" "$2"; }
fail() {
  say fail "$1" >&2
  exit 1
}

# The main checkout is the first entry of `git worktree list`. Empty when this
# is the main checkout itself.
main_checkout() {
  main=$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
  [ -n "$main" ] || return 0
  main=$(cd "$main" 2>/dev/null && pwd -P) || return 0
  [ "$main" = "$root" ] || printf %s "$main"
}

venv_ok() {
  [ -x "$1/bin/python" ] && "$1/bin/python" -c 'import paho.mqtt' 2>/dev/null
}

# --- frontend dependencies ------------------------------------------------------

command -v pnpm >/dev/null 2>&1 || fail "pnpm not found; install it (version pinned in frontend/package.json)"
if (cd frontend && pnpm install --frozen-lockfile --reporter=silent) >/dev/null 2>&1; then
  say ok "frontend deps (pnpm install --frozen-lockfile)"
else
  # Re-run with output so the reason is visible.
  (cd frontend && pnpm install --frozen-lockfile) >&2 || true
  fail "pnpm install --frozen-lockfile failed in frontend/"
fi

# --- per-checkout dev ports --------------------------------------------------------

launch="$root/.claude/launch.json"
before=$(cat "$launch" 2>/dev/null || true)
scripts/dev-ports.sh write-launch 2>/dev/null || fail "scripts/dev-ports.sh write-launch failed"
if [ "$before" = "$(cat "$launch")" ]; then
  say skip ".claude/launch.json (up to date)"
else
  say set ".claude/launch.json ($(scripts/dev-ports.sh | tr '\n' ' '))"
fi

# --- frontend/dist stub for the Go embed --------------------------------------------

if [ -f frontend/dist/index.html ]; then
  say skip "frontend/dist (index.html present)"
else
  mkdir -p frontend/dist
  echo "<html></html>" >frontend/dist/index.html
  say set "frontend/dist (stub index.html)"
fi

# --- git hooks (per clone, shared by every worktree) ---------------------------------

if [ "$(git config --get core.hooksPath 2>/dev/null || true)" = ".githooks" ]; then
  say skip "core.hooksPath (.githooks)"
else
  git config core.hooksPath .githooks || fail "git config core.hooksPath .githooks failed"
  say set "core.hooksPath (.githooks)"
fi

# Last, because it is the only step that needs python and the network: a
# machine without either still gets everything above.
# --- python venv for the MQTT harness scripts ------------------------------------

venv="$root/scripts/.venv"
if venv_ok "$venv"; then
  if [ -L "$venv" ]; then
    say skip "scripts/.venv (symlink to $(readlink "$venv"), paho-mqtt present)"
  else
    say skip "scripts/.venv (paho-mqtt present)"
  fi
else
  created=0
  if [ ! -e "$venv" ] && command -v python3 >/dev/null 2>&1; then
    if python3 -m venv "$venv" >/dev/null 2>&1 &&
      "$venv/bin/python" -m pip install --disable-pip-version-check -q --timeout 20 paho-mqtt >/dev/null 2>&1 &&
      venv_ok "$venv"; then
      created=1
      say set "scripts/.venv (created, paho-mqtt installed)"
    else
      rm -rf "$venv"
    fi
  elif [ -d "$venv" ] && [ ! -L "$venv" ] && [ -x "$venv/bin/python" ]; then
    # A venv exists but lacks paho-mqtt: install into it.
    if "$venv/bin/python" -m pip install --disable-pip-version-check -q --timeout 20 paho-mqtt >/dev/null 2>&1 &&
      venv_ok "$venv"; then
      created=1
      say set "scripts/.venv (paho-mqtt installed into existing venv)"
    fi
  fi
  if [ "$created" = 0 ]; then
    main=$(main_checkout)
    if [ -n "$main" ] && venv_ok "$main/scripts/.venv"; then
      if [ -e "$venv" ] && [ ! -L "$venv" ]; then
        fail "scripts/.venv exists but has no working paho-mqtt; remove it and re-run"
      fi
      ln -sfn "$main/scripts/.venv" "$venv"
      say set "scripts/.venv (symlinked to $main/scripts/.venv; creating one failed)"
    else
      fail "scripts/.venv: could not create a venv with paho-mqtt (python3 missing or pip offline?) and no main checkout venv to link"
    fi
  fi
fi

say ok "checkout ready: $root"
