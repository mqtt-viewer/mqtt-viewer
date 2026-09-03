#!/usr/bin/env bash
# Publish a release: render the notes, fast-forward main from origin/develop,
# and create the GitHub release that fires the build+sign+portal workflows.
#
#   scripts/release.sh VERSION PREV [PRERELEASE]
#
# `just release` is a one-liner over this script, so the recipe and
# scripts/test-release-recipe.sh exercise the same code.
#
# Every step is its own command. A `&&` chain would only trip errexit on its
# last command, so a failed checkout or merge would still reach `gh` and tag
# the old main.
set -euo pipefail

version="${1:-}"
prev="${2:-}"
prerelease="${3:-}"

if [ -z "$version" ]; then
  echo "usage: scripts/release.sh VERSION PREV [PRERELEASE]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

# Pre-flight. The notes are rendered from the working tree, and that tree is
# what becomes main a moment later, so the two have to be the same thing.
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash before releasing, so the notes render from the tree that becomes main." >&2
  exit 1
fi

git fetch origin develop

head_sha="$(git rev-parse HEAD)"
develop_sha="$(git rev-parse origin/develop)"
if [ "$head_sha" != "$develop_sha" ]; then
  echo "HEAD ($head_sha) is not origin/develop ($develop_sha). Check out the commit that is about to become main, so the notes match the release." >&2
  exit 1
fi

notes="$(mktemp -t mqtt-viewer-release-notes.XXXXXX)"
trap 'rm -f "$notes"' EXIT

node scripts/release-notes.mjs "$version" "$prev" > "$notes"

git checkout main
git merge --ff-only origin/develop
ALLOW_MAIN_PUSH=1 git push origin main

if [ -n "$prerelease" ]; then
  gh release create "$version" --target main "$prerelease" --notes-file "$notes" --title "$version"
else
  gh release create "$version" --target main --notes-file "$notes" --title "$version"
fi
