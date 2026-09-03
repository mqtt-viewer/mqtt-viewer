test PATH='./...': stub-dist
  set -o pipefail && go test {{PATH}} fmt -json | tparse -all

# main.go embeds frontend/dist, which is gitignored and so missing on a fresh
# checkout - without it the root package fails to load and any ./... command
# fails. Stub it so Go-only workflows work without a full frontend build.
# Mirrors the stub in build/Taskfile.yml's generate:bindings task.
stub-dist:
  mkdir -p frontend/dist
  [ -f frontend/dist/index.html ] || echo "<html></html>" > frontend/dist/index.html

new-migration NAME:
  atlas migrate diff --env gorm {{NAME}}

build VERSION="v0.0.1-defaultv":
  wails3 task package VERSION={{VERSION}} LD_FLAGS="-X mqtt-viewer/backend/env.Version={{VERSION}}"

# Port derived per checkout (scripts/dev-ports.sh) so parallel worktrees
# don't collide; set WAILS_VITE_PORT to override.
dev:
  wails3 dev -port $(scripts/dev-ports.sh vite)

# Preview the release body for a version: the promoted entry in
# frontend/src/changelog.ts, rendered as markdown. This is what lands on the
# GitHub release, goes to the portal, and shows in the in-app update dialog.
# PREV adds the compare link.
release-notes VERSION PREV="":
  node scripts/release-notes.mjs {{VERSION}} {{PREV}}

# Publish a release: merges develop→main and creates the GitHub release that
# triggers the mac/windows/linux build+sign+portal-registration workflows.
# See docs/RELEASING.md. Use PRERELEASE="--prerelease" for a dry-run tag.
# The notes are rendered first, so a changelog missing the entry for VERSION
# stops the release before main moves.
release VERSION PREV PRERELEASE="":
  #!/usr/bin/env bash
  set -euo pipefail
  notes="$(mktemp -t mqtt-viewer-release-notes)"
  trap 'rm -f "$notes"' EXIT
  node scripts/release-notes.mjs {{VERSION}} {{PREV}} > "$notes"
  git checkout main && git merge --ff-only origin/develop && git push origin main
  gh release create {{VERSION}} --target main {{PRERELEASE}} --notes-file "$notes" --title "{{VERSION}}"

# Delete + recreate a release tag after a CI fix (workflows run from the tag's
# commit, so a plain re-run would use the old workflow definitions).
release-retry VERSION PREV PRERELEASE="":
  gh release delete {{VERSION}} --cleanup-tag --yes
  just release {{VERSION}} {{PREV}} {{PRERELEASE}}

release-status:
  gh run list --limit 6