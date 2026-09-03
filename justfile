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