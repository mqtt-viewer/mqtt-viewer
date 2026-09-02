---
name: release
description: Publish a MQTT Viewer release end to end. Use when the user says "release", "cut a release", "publish vX.Y.Z", "ship it", or "do a release". First drafts the changelog for user approval, then promotes it, creates the GitHub release that triggers the mac/windows/linux build+sign+portal workflows, watches them, and hands off the final go-live step.
---

# Release MQTT Viewer

Drives the runbook in `docs/RELEASING.md`. One release is one annotated GitHub
release on `main`; publishing it fires three workflows (mac / windows / linux)
that build, sign, upload assets, and register the version with the portal.
Nothing reaches users until the `released` toggle is flipped in the portal.

Creating a GitHub release is outward-facing and hard to undo. **Confirm the
version with the user and get an explicit go-ahead before step 5.**

## Inputs

- `VERSION`: the tag, `vX.Y.Z` (or `vX.Y.Z-beta1` for a dry run). If the user
  didn't give one, ask. Decide the bump (patch vs minor vs major) now, from what
  actually landed since the last release. Do not pre-empt it earlier.
- `PREV`: the previous release tag, for release notes. Get it with
  `gh release list --limit 5` or `git tag --sort=-v:refname | head`.

## 1. Draft the changelog and get it approved (always first)

Before any release mechanics, show the user what the release will say. This is
the gate that lets them see, and shape, what's going into the upcoming release.

- Gather what shipped since `PREV`: `git log PREV..origin/develop --oneline`
  plus the merged PRs (`gh pr list --state merged --base develop`). Keep only
  user-visible changes, per the `/changelog` skill's rules.
- Build the draft from the staging entry in `frontend/src/changelog.ts` if one
  exists, folding in anything that landed since it was last updated. If there's
  no staging entry, draft one from scratch using the `/changelog` skill.
  Follow `docs/WRITING_STYLE.md`.
- Present the full draft in chat: headline, intro, every section, outro. Also
  list anything you judged NOT worth mentioning, so the user can veto that
  judgement.
- Wait for the user to approve or request edits. Apply edits and re-present
  until they explicitly approve. **Do not start pre-flight, and do not touch
  `main`, until the draft is approved.**
- Once approved, write the result back to the staging entry in
  `frontend/src/changelog.ts` (still `released: false`); step 3 promotes it.

## 2. Pre-flight

- `git fetch --all --tags`.
- Confirm `develop` is the integration branch and is green (latest CI passing).
- Confirm `main` can fast-forward from `origin/develop`
  (`git merge-base --is-ancestor origin/main origin/develop`). If it can't, stop
  and tell the user: `main` has diverged and `just release` will fail its
  `--ff-only` merge.
- Working tree clean, `gh auth status` OK.

## 3. Promote the changelog (this is what makes updates show notes)

The shipped binary carries its own changelog, matched to its version at runtime.
If you skip this, users who update see no "What's new". So:

- In `frontend/src/changelog.ts`, take the approved staging entry from step 1
  and promote it: set `released: true`, `version` to the bare semver
  (`"X.Y.Z"`, no `v`, must match `VERSION`), and `date` to `"Month YYYY"`.
- Give it a real `headline` if it still has the placeholder.
- The content itself was approved in step 1; don't rewrite it here beyond the
  promotion fields.

Then validate and land it on `develop`:

```sh
cd frontend && pnpm test:run changelog && pnpm check
git add -A && git commit -m "chore(changelog): notes for VERSION"
git push origin develop
```

The commit must be on `develop` and pushed before step 5, because `just release`
fast-forwards `main` from `origin/develop`.

## 4. Dry run (recommended for risky releases)

```sh
just release vX.Y.Z-beta1 PREV --prerelease
just release-status   # watch the three workflows
```

Fix any CI issues and use `just release-retry` (delete + recreate the tag, so
workflows run from the fixed commit) rather than a plain re-run.

## 5. The real release (confirm first)

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

## 6. Go live (manual, human gate)

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
