#!/usr/bin/env bash
# Exercises scripts/release.sh, the body of the `just release` recipe, with
# `git` and `gh` replaced by shims on PATH. Nothing here touches a real
# repository, a real remote or GitHub.
#
# What it pins down:
#   a) a failing `git merge` never reaches `gh`
#   b) a failing `git checkout` never reaches `gh`
#   c) the success path passes --notes-file with exactly the bytes
#      `node scripts/release-notes.mjs VERSION PREV` prints
#   d) the temp notes file is removed on every path
#   e) PRERELEASE lands in the `gh release create` argv
#   f) the pre-flight guards stop a dirty tree or a HEAD that is not
#      origin/develop before anything is created
#
#   bash scripts/test-release-recipe.sh
set -uo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
release_sh="$repo_root/scripts/release.sh"

VERSION="v1.0.0"
PREV="v0.7.0"

work="$(mktemp -d -t mqtt-viewer-release-test.XXXXXX)"
trap 'rm -rf "$work"' EXIT

shims="$work/shims"
mkdir -p "$shims"

cat > "$shims/git" <<'SHIM'
#!/usr/bin/env bash
# Records its argv, answers the two queries release.sh reads, and fails the
# subcommand named in GIT_SHIM_FAIL.
printf '%s\n' "$@" >> "$SHIM_GIT_LOG"
sub="${1:-}"
case "$sub" in
  status)
    [ "${GIT_SHIM_DIRTY:-0}" = "1" ] && echo " M frontend/src/changelog.ts"
    exit 0
    ;;
  rev-parse)
    if [ "${GIT_SHIM_DIVERGE:-0}" = "1" ] && [ "${2:-}" = "HEAD" ]; then
      echo "1111111111111111111111111111111111111111"
    else
      echo "0000000000000000000000000000000000000000"
    fi
    exit 0
    ;;
esac
if [ -n "${GIT_SHIM_FAIL:-}" ] && [ "$sub" = "$GIT_SHIM_FAIL" ]; then
  echo "git shim: forced failure on '$sub'" >&2
  exit 1
fi
exit 0
SHIM

cat > "$shims/gh" <<'SHIM'
#!/usr/bin/env bash
# Records its argv and keeps a copy of whatever --notes-file pointed at, since
# release.sh deletes that file on exit.
printf '%s\n' "$@" >> "$SHIM_GH_LOG"
prev=""
for arg in "$@"; do
  if [ "$prev" = "--notes-file" ]; then
    printf '%s\n' "$arg" > "$SHIM_GH_NOTES_PATH"
    cp "$arg" "$SHIM_GH_NOTES_BODY"
  fi
  prev="$arg"
done
exit 0
SHIM

chmod +x "$shims/git" "$shims/gh"

expected_notes="$work/expected-notes.md"
if ! node "$repo_root/scripts/release-notes.mjs" "$VERSION" "$PREV" > "$expected_notes"; then
  echo "FATAL: node scripts/release-notes.mjs $VERSION $PREV failed" >&2
  exit 1
fi

failures=0
run_no=0
status=0
tmp_home=""

ok() { printf '  ok   %s\n' "$1"; }
fail() {
  printf '  FAIL %s\n' "$1"
  failures=$((failures + 1))
}
check() {
  if [ "$1" = "true" ]; then ok "$2"; else fail "$2"; fi
}

# Runs release.sh with the shims in front of PATH and a private TMPDIR, so the
# temp notes file can be spotted if it is left behind.
run_release() {
  run_no=$((run_no + 1))
  tmp_home="$work/tmp$run_no"
  mkdir -p "$tmp_home"
  SHIM_GIT_LOG="$work/git$run_no.log"
  SHIM_GH_LOG="$work/gh$run_no.log"
  SHIM_GH_NOTES_PATH="$work/notes-path$run_no.txt"
  SHIM_GH_NOTES_BODY="$work/notes-body$run_no.md"
  export SHIM_GIT_LOG SHIM_GH_LOG SHIM_GH_NOTES_PATH SHIM_GH_NOTES_BODY
  : > "$SHIM_GIT_LOG"
  PATH="$shims:$PATH" TMPDIR="$tmp_home" bash "$release_sh" "$@" \
    > "$work/stdout$run_no.txt" 2> "$work/stderr$run_no.txt"
  status=$?
}

gh_ran() { [ -f "$SHIM_GH_LOG" ] && echo true || echo false; }

git_saw() {
  grep -qxF -- "$1" "$SHIM_GIT_LOG" && echo true || echo false
}

gh_saw() {
  [ -f "$SHIM_GH_LOG" ] && grep -qxF -- "$1" "$SHIM_GH_LOG" && echo true || echo false
}

no_temp_left() {
  local left
  left="$(find "$tmp_home" -name 'mqtt-viewer-release-notes.*' 2>/dev/null)"
  [ -z "$left" ] && echo true || echo false
}

echo "a) a failing merge never reaches gh"
GIT_SHIM_FAIL=merge run_release "$VERSION" "$PREV"
unset GIT_SHIM_FAIL
check "$([ "$status" -ne 0 ] && echo true || echo false)" "release.sh exits non-zero (got $status)"
check "$(git_saw checkout)" "checkout ran"
if [ "$(git_saw push)" = "true" ]; then
  fail "push must not run after a failed merge"
else
  ok "push did not run after a failed merge"
fi
check "$([ "$(gh_ran)" = "false" ] && echo true || echo false)" "gh was never invoked"
check "$(no_temp_left)" "temp notes file removed"

echo "b) a failing checkout never reaches gh"
GIT_SHIM_FAIL=checkout run_release "$VERSION" "$PREV"
unset GIT_SHIM_FAIL
check "$([ "$status" -ne 0 ] && echo true || echo false)" "release.sh exits non-zero (got $status)"
if [ "$(git_saw merge)" = "true" ]; then
  fail "merge must not run after a failed checkout"
else
  ok "merge did not run after a failed checkout"
fi
check "$([ "$(gh_ran)" = "false" ] && echo true || echo false)" "gh was never invoked"
check "$(no_temp_left)" "temp notes file removed"

echo "c) the success path hands gh the rendered notes"
run_release "$VERSION" "$PREV"
check "$([ "$status" -eq 0 ] && echo true || echo false)" "release.sh exits zero (got $status)"
check "$(gh_saw --notes-file)" "gh got --notes-file"
check "$(gh_saw "$VERSION")" "gh got the version"
check "$(gh_saw --target)" "gh got --target main"
if [ -f "$SHIM_GH_NOTES_BODY" ] && cmp -s "$expected_notes" "$SHIM_GH_NOTES_BODY"; then
  ok "notes are byte-identical to scripts/release-notes.mjs output"
else
  fail "notes differ from scripts/release-notes.mjs output"
  [ -f "$SHIM_GH_NOTES_BODY" ] && diff "$expected_notes" "$SHIM_GH_NOTES_BODY" | head -20
fi
if [ -f "$SHIM_GH_NOTES_PATH" ] && [ ! -e "$(cat "$SHIM_GH_NOTES_PATH")" ]; then
  ok "the temp file gh was given is gone afterwards"
else
  fail "the temp file gh was given still exists"
fi
check "$(no_temp_left)" "temp notes file removed"

echo "d) PRERELEASE reaches gh"
run_release "$VERSION" "$PREV" --prerelease
check "$([ "$status" -eq 0 ] && echo true || echo false)" "release.sh exits zero (got $status)"
check "$(gh_saw --prerelease)" "gh got --prerelease"
check "$(no_temp_left)" "temp notes file removed"

echo "e) an empty PRERELEASE does not become an empty argument"
run_release "$VERSION" "$PREV" ""
check "$([ "$status" -eq 0 ] && echo true || echo false)" "release.sh exits zero (got $status)"
if grep -qx '' "$SHIM_GH_LOG"; then
  fail "gh received an empty argument"
else
  ok "gh received no empty argument"
fi

echo "f) pre-flight guards stop before anything is created"
GIT_SHIM_DIRTY=1 run_release "$VERSION" "$PREV"
unset GIT_SHIM_DIRTY
check "$([ "$status" -ne 0 ] && echo true || echo false)" "a dirty tree aborts (got $status)"
check "$([ "$(gh_ran)" = "false" ] && echo true || echo false)" "gh was never invoked"
if [ "$(git_saw checkout)" = "true" ]; then
  fail "checkout must not run on a dirty tree"
else
  ok "checkout did not run"
fi
check "$(no_temp_left)" "temp notes file removed"

GIT_SHIM_DIVERGE=1 run_release "$VERSION" "$PREV"
unset GIT_SHIM_DIVERGE
check "$([ "$status" -ne 0 ] && echo true || echo false)" "a HEAD off origin/develop aborts (got $status)"
check "$([ "$(gh_ran)" = "false" ] && echo true || echo false)" "gh was never invoked"
if [ "$(git_saw checkout)" = "true" ]; then
  fail "checkout must not run when HEAD is not origin/develop"
else
  ok "checkout did not run"
fi
check "$(no_temp_left)" "temp notes file removed"

echo
if [ "$failures" -eq 0 ]; then
  echo "all release recipe checks passed"
  exit 0
fi
echo "$failures check(s) failed"
exit 1
