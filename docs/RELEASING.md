# Releasing MQTT Viewer

One release = one annotated GitHub release on `main`. Publishing the release
fires three workflows (mac / windows / linux) that build, sign, upload assets,
and register the version with the portal. Nothing reaches users until you flip
the `released` toggle in the portal admin.

The `/release` skill drives this whole runbook. Its first step is always a
changelog draft presented for approval, so you see and shape what the release
will say before any mechanics run; then changelog promotion, release creation,
workflow watching, and the go-live handoff. This doc is the reference it
follows.

## TL;DR

```sh
# 1. get develop green and merged
#    (ALLOW_MAIN_PUSH=1 satisfies the .githooks/pre-push guard; a GitHub
#    ruleset separately blocks force-pushes and deletion on main)
git checkout main && git merge --ff-only origin/develop && ALLOW_MAIN_PUSH=1 git push

# 2. read what the release will actually say
just release-notes v0.X.Y <previous-tag>

# 3. dry-run with a prerelease (optional but recommended for risky changes)
just release v0.X.Y-beta1 <previous-tag> --prerelease

# 4. the real thing
just release v0.X.Y <previous-tag>

# 5. watch the three workflows
gh run list --limit 5

# 6. flip `released` on the new release_v3 record in the PocketBase admin UI
#    (https://cloud.mqttviewer.app/_/) once you're happy. This is what makes
#    in-app update checks see the version.
```

To re-run a failed release after fixing CI: delete + recreate the release.
Workflows run from the tag's commit, so a plain "re-run" would use the old
workflow definitions.

```sh
just release-retry v0.X.Y <previous-tag>
```

## Where the release notes come from

The release body is the app's own changelog entry for the version, rendered as
markdown by `scripts/release-notes.mjs` from `frontend/src/changelog.ts`. It is
not GitHub's generated list of merged pull requests.

That matters because the notes travel: each workflow POSTs
`github.event.release.body` to the portal as `release_notes`, and the in-app
update dialog shows that text under "What's changed". So a user reads the same
words before updating that they read in "What's new" afterwards.

The practical consequence: **promote the changelog entry, with `released: true`
and the bare semver, and get it onto `develop` before you create the release.**
`just release` renders the notes first and stops if the entry is missing, so a
forgotten promotion fails loudly instead of shipping an empty dialog.

`just release` is a one-liner over `scripts/release.sh`, which runs three
pre-flight checks before it touches anything. It aborts if the working tree is
dirty, if `HEAD` is not `origin/develop` after a fetch, and if the changelog has
no promoted entry for the version. The first two exist because the notes are
rendered from the tree you are standing on, and that tree is what becomes
`main` a moment later, so the two have to be the same commit. Every step is its
own command, so a failed checkout or merge stops there instead of falling
through to `gh release create`. `scripts/test-release-recipe.sh` covers those
paths with shimmed `git` and `gh`.

```sh
just release-notes v0.X.Y <previous-tag>   # preview, exactly what gets posted
```

A prerelease tag (`v0.X.Y-beta1`) uses the entry for the version it rehearses,
so a dry run shows the real notes.

## What each workflow needs (and where it breaks)

| Platform | Signing | Gotchas |
|---|---|---|
| mac (`release-mac.yaml`) | gon codesign + notarytool | Notarization 403 "agreement missing" → sign the latest agreements at developer.apple.com / App Store Connect. Certificate secrets: `APPLE_DEVELOPER_CERTIFICATE_*`, `AC_*`. |
| windows (`release-windows.yaml`) | Azure Trusted Signing | Secrets `AZURE_*`. NSIS `VIFileVersion` needs numeric versions, so pre-release suffixes are stripped into `INFO_FILEVERSION` by the taskfile. |
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
- windows: `..._windows_{amd64,arm64}.zip` + `..._installer.exe` (+ `.sha256`)
- linux: `..._linux_{amd64,arm64}.{zip,AppImage,deb,rpm,flatpak}` (+ `.sha256`)

Linux distro guidance: deb/rpm use the system WebKit and are the most
compatible (Fedora needs the rpm, because the AppImage bundles Ubuntu-built
WebKit whose helper paths don't exist elsewhere). AppImage works on the
Debian/Ubuntu family with `libwebkit2gtk-4.1-0` installed.

### Flatpak

Each release also produces a single-file `.flatpak` bundle per architecture,
uploaded as a release asset alongside the deb and rpm. Users can install it
directly:

```sh
flatpak install ./MQTT_Viewer_<tag>_linux_amd64.flatpak
```

The Flatpak build cannot run on macOS. It is verified in CI by
`.github/workflows/flatpak-check.yaml`, which builds the bundle and launches
it headlessly on every pull request that touches `build/linux/flatpak/`,
failing if the GNOME runtime no longer ships `webkit2gtk-4.1`.

The bundled binary links `webkit2gtk-4.1` (the `-tags gtk3` stack), so the
manifest pins `org.gnome.Platform` to a runtime that still ships it. Keep
`RUNTIME_VERSION` (in the manifest and both Flatpak workflows) on the newest
supported GNOME runtime; the CI smoke test catches a runtime that has dropped
the GTK3 WebKit.

#### Hosted repository (auto-updating installs)

`.github/workflows/flatpak-publish.yaml` builds both architectures, merges
them into one GPG-signed OSTree repository and deploys it to GitHub Pages, so
that installs update through `flatpak update`. It runs on every published
release, and can be triggered manually:

```sh
gh workflow run flatpak-publish.yaml --ref develop -f version=v0.0.0-test
```

Already configured: the `FLATPAK_GPG_PRIVATE_KEY` signing secret and GitHub
Pages (source: GitHub Actions). The private key is held offline by the
maintainer; losing it means clients must re-add the remote after a re-key.

To serve from a custom subdomain instead of the default
`https://mqtt-viewer.github.io/mqtt-viewer`:

1. Add a DNS CNAME, e.g. `dl.mqttviewer.app` -> `mqtt-viewer.github.io`.
2. Set the repository variables `FLATPAK_REPO_BASE_URL`
   (e.g. `https://dl.mqttviewer.app`) and `FLATPAK_REPO_CUSTOM_DOMAIN`
   (e.g. `dl.mqttviewer.app`), then re-run the publish workflow.

Once live, users add the remote and install once:

```sh
flatpak remote-add --if-not-exists mqtt-viewer https://dl.mqttviewer.app/mqtt-viewer.flatpakrepo
flatpak install mqtt-viewer app.mqttviewer.MQTTViewer
```

#### Flathub (future)

The manifest and `metainfo.xml` are written to Flathub's requirements, so
the same files can seed a Flathub submission (see
`build/linux/flatpak/FLATHUB.md`). Flathub then hosts and auto-updates the
app, which would make the self-hosted repository above redundant.
