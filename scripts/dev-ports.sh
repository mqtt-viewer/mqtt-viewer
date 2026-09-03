#!/bin/sh
# Deterministic per-checkout dev ports so multiple agents (each in their own
# git worktree) can run wails3 dev and Storybook side by side without port
# collisions. The port is derived from the checkout's absolute path, so it is
# stable across runs but different between worktrees.
#
# Usage:
#   scripts/dev-ports.sh              # print both as KEY=VALUE lines
#   scripts/dev-ports.sh vite         # print the Vite/wails dev port
#   scripts/dev-ports.sh storybook    # print the Storybook port
#   scripts/dev-ports.sh write-launch # write .claude/launch.json with these ports
#
# Overrides: WAILS_VITE_PORT and STORYBOOK_PORT env vars win when set.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd -P)
hash=$(printf %s "$root" | cksum | cut -d' ' -f1)
slot=$((hash % 200))

vite_port="${WAILS_VITE_PORT:-$((9300 + slot))}"
storybook_port="${STORYBOOK_PORT:-$((6100 + slot))}"

write_launch() {
  mkdir -p "$root/.claude"
  cat >"$root/.claude/launch.json" <<EOF
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "storybook",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--dir", "frontend", "exec", "storybook", "dev", "-p", "$storybook_port", "--no-open", "--ci", "--exact-port"],
      "port": $storybook_port
    },
    {
      "name": "wails",
      "runtimeExecutable": "wails3",
      "runtimeArgs": ["dev", "-config", "./build/config.yml", "-port", "$vite_port"],
      "port": $vite_port
    }
  ]
}
EOF
  echo "wrote $root/.claude/launch.json (vite=$vite_port storybook=$storybook_port)" >&2
}

case "${1:-}" in
  vite) echo "$vite_port" ;;
  storybook) echo "$storybook_port" ;;
  write-launch) write_launch ;;
  "")
    echo "WAILS_VITE_PORT=$vite_port"
    echo "STORYBOOK_PORT=$storybook_port"
    ;;
  *)
    echo "usage: $0 [vite|storybook|write-launch]" >&2
    exit 2
    ;;
esac
