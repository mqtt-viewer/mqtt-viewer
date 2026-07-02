---
name: release
description: Publish a MQTT Viewer release end to end. Use when the user says "release", "cut a release", "publish vX.Y.Z", "ship it", or "do a release". Promotes the changelog, creates the GitHub release that triggers the mac/windows/linux build+sign+portal workflows, watches them, and hands off the final go-live step.
---

# Release MQTT Viewer

Drives the runbook in `docs/RELEASING.md`. One release is one annotated GitHub
release on `main`; publishing it fires three workflows (mac / windows / linux)
that build, sign, upload assets, and register the version with the portal.
Nothing reaches users until the `released` toggle is flipped in the portal.

Creating a GitHub release is outward-facing and hard to undo. **Confirm the
version with the user and get an explicit go-ahead before step 4.**

## Inputs

- `VERSION`: the tag, `vX.Y.Z` (or `vX.Y.Z-beta1` for a dry run). If the user
  didn't give one, ask. Decide the bump (patch vs minor vs major) now, from what
  actually landed since the last release. Do not pre-empt it earlier.
- `PREV`: the previous release tag, for release notes. Get it with
  `gh release list --limit 5` or `git tag --sort=-v:refname | head`.

## 1. Pre-flight

- `git fetch --all --tags`.
- Confirm `develop` is the integration branch and is green (latest CI passing).
- Confirm `main` can fast-forward from `origin/develop`
  (`git merge-base --is-ancestor origin/main origin/develop`). If it can't, stop
  and tell the user: `main` has diverged and `just release` will fail its
  `--ff-only` merge.
- Working tree clean, `gh auth status` OK.

## 2. Promote the changelog (this is what makes updates show notes)

The shipped binary carries its own changelog, matched to its version at runtime.
If you skip this, users who update see no "What's new". So:

- In `frontend/src/changelog.ts`, take the top `released: false` staging entry
  and promote it: set `released: true`, `version` to the bare semver
  (`"X.Y.Z"`, no `v`, must match `VERSION`), and `date` to `"Month YYYY"`.
- Give it a real `headline` if it still has the placeholder.
- Follow `docs/WRITING_STYLE.md`: warm, first person, British spelling, no em
  dashes, no emojis.
- If there's no staging entry or it has no sections, run the `/changelog` skill
  first to gather what shipped since `PREV`.

Then validate and land it on `develop`:

```sh
cd frontend && pnpm test:run changelog && pnpm check
git add -A && git commit -m "chore(changelog): notes for VERSION"
git push origin develop
```

The commit must be on `develop` and pushed before step 4, because `just release`
fast-forwards `main` from `origin/develop`.

## 3. Dry run (recommended for risky releases)

```sh
just release vX.Y.Z-beta1 PREV --prerelease
just release-status   # watch the three workflows
```

Fix any CI issues and use `just release-retry` (delete + recreate the tag, so
workflows run from the fixed commit) rather than a plain re-run.

## 4. The real release (confirm first)

```sh
just release VERSION PREV
```

This merges `develop` into `main`, pushes, and runs `gh release create` with
generated notes from `PREV`. Then watch:

```sh
just release-status
gh run list --limit 6
```

Expected assets (see `docs/RELEASING.md` for the full list): darwin arm64/amd64
zips, windows zip + installer.exe, linux zip/AppImage/deb/rpm, each with a
`.sha256`.

## 5. Go live (manual, human gate)

The workflows POST each artifact to the portal, creating one `release_v3` record
with `released=false`. It reaches users only when someone flips `released=true`.

- Tell the user to open the PocketBase admin at https://cloud.mqttviewer.app/_/,
  find the new `release_v3` record, confirm all platform artifacts merged into
  it, and flip `released` when happy. The in-app updater
  (`POST /api/cv1/updates/v3/check`) only serves `released=true`.
- This step is the user's to do. Do not attempt to flip it yourself.

## Notes

- Signing (Apple gon/notarytool, Azure Trusted Signing) and portal auth all run
  from CI secrets; see the table in `docs/RELEASING.md` for where each breaks.
- After go-live, verify an update check picks up the new version.
