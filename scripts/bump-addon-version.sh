#!/usr/bin/env bash
# Pin the Home Assistant add-on manifest to a published MQTT Viewer image tag.
#
# The add-on lives in mqtt-viewer/home-assistant-addon. Home Assistant pulls
# <image>:<version> straight from the manifest, so that version must always
# name a tag that exists in GHCR. The Docker release workflow calls this
# script (see .github/workflows/docker-publish.yaml, job bump-addon) so the
# pin cannot drift from the published image.
#
# Usage:
#   scripts/bump-addon-version.sh <version> <release-url> [addon-dir]
#
#   version      bare semver, no leading "v" (e.g. 1.1.0)
#   release-url  link to the GitHub release, used in the changelog entry
#   addon-dir    directory holding config.yaml (default: mqtt-viewer)
#
# Edits exactly one line of config.yaml (the top-level `version:` key) and
# prepends a CHANGELOG.md entry when that file exists. Re-running it for the
# same version is a no-op, so the caller can decide what to do by checking
# whether the working tree changed.
set -euo pipefail

version="${1:-}"
release_url="${2:-}"
addon_dir="${3:-mqtt-viewer}"

if [ -z "$version" ] || [ -z "$release_url" ]; then
  echo "usage: $0 <version> <release-url> [addon-dir]" >&2
  exit 2
fi

case "$version" in
  v*)
    echo "error: version must not carry a leading 'v' (got '$version')" >&2
    exit 2
    ;;
esac

config="$addon_dir/config.yaml"
changelog="$addon_dir/CHANGELOG.md"

if [ ! -f "$config" ]; then
  echo "error: no manifest at $config" >&2
  exit 1
fi

current="$(sed -n -E 's/^version:[[:space:]]*"?([^"[:space:]]+)"?[[:space:]]*$/\1/p' "$config" | head -n 1)"
if [ -z "$current" ]; then
  echo "error: no top-level 'version:' line in $config" >&2
  exit 1
fi

if [ "$current" = "$version" ]; then
  echo "add-on already pinned to $version, nothing to do"
  exit 0
fi

echo "bumping add-on pin: $current -> $version"

sed -i.bak -E "s|^version:[[:space:]]*.*$|version: \"$version\"|" "$config"
rm -f "$config.bak"

check="$(sed -n -E 's/^version:[[:space:]]*"?([^"[:space:]]+)"?[[:space:]]*$/\1/p' "$config" | head -n 1)"
if [ "$check" != "$version" ]; then
  echo "error: rewrite failed, $config still reads '$check'" >&2
  exit 1
fi

if [ ! -f "$changelog" ]; then
  echo "no $changelog, skipping the changelog entry"
  exit 0
fi

if grep -qE "^##[[:space:]]+$(printf '%s' "$version" | sed 's/\./\\./g')[[:space:]]*$" "$changelog"; then
  echo "changelog already has a '## $version' entry, leaving it alone"
  exit 0
fi

entry_file="$(mktemp)"
trap 'rm -f "$entry_file"' EXIT
{
  printf '## %s\n\n' "$version"
  printf -- '- Updates MQTT Viewer to %s. See the release notes: %s\n' "$version" "$release_url"
} > "$entry_file"

# Keep an existing "# Title" heading at the top and insert underneath it;
# otherwise the entry goes to the very top of the file.
new_file="$(mktemp)"
trap 'rm -f "$entry_file" "$new_file"' EXIT
if head -n 1 "$changelog" | grep -qE '^#[[:space:]]'; then
  {
    head -n 1 "$changelog"
    printf '\n'
    cat "$entry_file"
    printf '\n'
    tail -n +2 "$changelog" | sed -e '/./,$!d'
  } > "$new_file"
else
  {
    cat "$entry_file"
    printf '\n'
    cat "$changelog"
  } > "$new_file"
fi
cat "$new_file" > "$changelog"

echo "prepended a '## $version' entry to $changelog"
