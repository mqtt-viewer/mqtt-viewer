# Releasing MQTT Viewer

One release = one annotated GitHub release on `main`. Publishing the release
fires three workflows (mac / windows / linux) that build, sign, upload assets,
and register the version with the portal. Nothing reaches users until you flip
the `released` toggle in the portal admin.

## TL;DR

```sh
# 1. get develop green and merged
git checkout main && git merge --ff-only origin/develop && git push

# 2. dry-run with a prerelease (optional but recommended for risky changes)
gh release create v0.X.Y-beta1 --target main --prerelease --generate-notes \
  --notes-start-tag <previous-tag> --title "v0.X.Y-beta1"

# 3. the real thing
gh release create v0.X.Y --target main --generate-notes \
  --notes-start-tag <previous-tag> --title "v0.X.Y"

# 4. watch the three workflows
gh run list --limit 5

# 5. flip `released` on the new release_v3 record in the PocketBase admin UI
#    (https://cloud.mqttviewer.app/_/) once you're happy — this is what makes
#    in-app update checks see the version.
```

To re-run a failed release after fixing CI: delete + recreate the release —
workflows run from the tag's commit, so a plain "re-run" would use the old
workflow definitions.

```sh
gh release delete v0.X.Y --cleanup-tag --yes && gh release create v0.X.Y ...
```

## What each workflow needs (and where it breaks)

| Platform | Signing | Gotchas |
|---|---|---|
| mac (`release-mac.yaml`) | gon codesign + notarytool | Notarization 403 "agreement missing" → sign the latest agreements at developer.apple.com / App Store Connect. Certificate secrets: `APPLE_DEVELOPER_CERTIFICATE_*`, `AC_*`. |
| windows (`release-windows.yaml`) | Azure Trusted Signing | Secrets `AZURE_*`. NSIS `VIFileVersion` needs numeric versions — pre-release suffixes are stripped into `INFO_FILEVERSION` by the taskfile. |
| linux (`release-linux.yaml`) | none | Runs on `ubuntu-latest` + `ubuntu-24.04-arm`. gtk3/webkit2gtk-4.1 dev packages must install **before** the wails3 CLI (`-tags gtk3`). |

Shared foundations that have bitten before:

- **Node version** must satisfy every transitive engine range (`oxc-parser`
  needs `^20.19 || >=22.12`). Keep `NODE_VERSION` at 22.x in all three
  workflows and pin pnpm to the version in `frontend/package.json`'s
  `packageManager` field.
- **Secrets** (repo → Settings → Actions): `AZURE_*` (6), `AC_*`/`APPLE_*` (5),
  `MACHINE_ID_SECRET`, `CLOUD_USERNAME`, `CLOUD_PASSWORD`,
  `CI_RELEASES_USERNAME`, `CI_RELEASES_PASSWORD`.

## Portal (mqtt-viewer/cloud, deployed on fly.io as `mqttviewer-cloud`)

- Each platform's final step POSTs its artifact to
  `POST /api/cv1/updates/v3/releases` (basic auth `CI_RELEASES_*`; artifacts
  merge across platforms into one `release_v3` record, created
  `released=false`).
- The in-app updater hits `POST /api/cv1/updates/v3/check`, which only serves
  records with `released=true`.
- Deploy the portal with `fly deploy -a mqttviewer-cloud` from the cloud repo;
  the same `CI_RELEASES_*` values must exist as fly secrets.

## Expected assets per release

- darwin: `MQTT_Viewer_<tag>_darwin_{arm64,amd64}.zip` (+ `.sha256`)
- windows: `..._windows_amd64.zip` + `..._installer.exe` (+ `.sha256`)
- linux: `..._linux_{amd64,arm64}.{zip,AppImage,deb,rpm}` (+ `.sha256`)

Linux distro guidance: deb/rpm use the system WebKit and are the most
compatible (Fedora needs the rpm — the AppImage bundles Ubuntu-built WebKit
whose helper paths don't exist elsewhere). AppImage works on Debian/Ubuntu
family with `libwebkit2gtk-4.1-0` installed.
