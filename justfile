# Make a fresh checkout or agent worktree ready to work in: frontend deps,
# scripts/.venv, .claude/launch.json, the dist stub and the git hooks.
# Idempotent; see scripts/setup-worktree.sh.
setup:
  scripts/setup-worktree.sh

# tparse is pinned and run through go run: releases before v0.17.0 misread the
# build-output events go1.24+ emits (linker warnings included) as a failed
# package with a blank name.
test PATH='./...': stub-dist test-broker
  set -o pipefail && go test {{PATH}} -json | go run github.com/mfridman/tparse@v0.18.0 -all

# main.go embeds frontend/dist, which is gitignored and so missing on a fresh
# checkout - without it the root package fails to load and any ./... command
# fails. Stub it so Go-only workflows work without a full frontend build.
# Mirrors the stub in build/Taskfile.yml's generate:bindings task.
stub-dist:
  mkdir -p frontend/dist
  [ -f frontend/dist/index.html ] || echo "<html></html>" > frontend/dist/index.html

# The mqtt and app tests connect to a local broker on localhost:1883 and fail
# with "the broker refused the connection" without one. Idempotent and shared
# across worktrees; see scripts/test-broker.sh.
test-broker:
  scripts/test-broker.sh up

new-migration NAME:
  atlas migrate diff --env gorm {{NAME}}

# Regenerate frontend/bindings. Runs the wails3 CLI pinned in go.mod, installed
# into .bin/ on first use: a CLI from any other tag rewrites every bindings
# file. See scripts/wails3.sh.
bindings:
  scripts/wails3.sh task -f common:generate:bindings

build VERSION="v0.0.1-defaultv":
  scripts/wails3.sh task package VERSION={{VERSION}} LD_FLAGS="-X mqtt-viewer/backend/env.Version={{VERSION}}"

# Port derived per checkout (scripts/dev-ports.sh) so parallel worktrees
# don't collide; set WAILS_VITE_PORT to override. The dev build regenerates
# bindings, so it runs the pinned CLI too.
dev:
  scripts/wails3.sh dev -port $(scripts/dev-ports.sh vite)

# The body comes from the promoted entry in frontend/src/changelog.ts, rendered
# as markdown. It is what lands on the GitHub release, goes to the portal, and
# shows in the in-app update dialog. PREV adds the compare link.
# Preview the release body for a version.
release-notes VERSION PREV="":
  node scripts/release-notes.mjs {{VERSION}} {{PREV}}

# Merges develop into main and creates the GitHub release that triggers the
# mac/windows/linux build+sign+portal-registration workflows. See
# docs/RELEASING.md. Use PRERELEASE="--prerelease" for a dry-run tag. Aborts
# before main moves if the tree is dirty, if HEAD is not origin/develop, or if
# the changelog has no promoted entry for VERSION.
# Publish a release.
release VERSION PREV PRERELEASE="":
  scripts/release.sh {{VERSION}} {{PREV}} {{PRERELEASE}}

# Workflows run from the tag's commit, so a plain re-run would use the old
# workflow definitions.
# Delete and recreate a release tag after a CI fix.
release-retry VERSION PREV PRERELEASE="":
  gh release delete {{VERSION}} --cleanup-tag --yes
  just release {{VERSION}} {{PREV}} {{PRERELEASE}}

release-status:
  gh run list --limit 6