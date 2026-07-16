test PATH='./...':
  set -o pipefail && go test {{PATH}} fmt -json | tparse -all

new-migration NAME:
  atlas migrate diff --env gorm {{NAME}}

build VERSION="v0.0.1-defaultv":
  wails3 task package VERSION={{VERSION}} LD_FLAGS="-X mqtt-viewer/backend/env.Version={{VERSION}}"

# Port derived per checkout (scripts/dev-ports.sh) so parallel worktrees
# don't collide; set WAILS_VITE_PORT to override.
dev:
  wails3 dev -port $(scripts/dev-ports.sh vite)

# Publish a release: merges develop→main and creates the GitHub release that
# triggers the mac/windows/linux build+sign+portal-registration workflows.
# See docs/RELEASING.md. Use PRERELEASE="--prerelease" for a dry-run tag.
release VERSION PREV PRERELEASE="":
  git checkout main && git merge --ff-only origin/develop && git push origin main
  gh release create {{VERSION}} --target main {{PRERELEASE}} --generate-notes --notes-start-tag {{PREV}} --title "{{VERSION}}"

# Delete + recreate a release tag after a CI fix (workflows run from the tag's
# commit, so a plain re-run would use the old workflow definitions).
release-retry VERSION PREV PRERELEASE="":
  gh release delete {{VERSION}} --cleanup-tag --yes
  just release {{VERSION}} {{PREV}} {{PRERELEASE}}

release-status:
  gh run list --limit 6