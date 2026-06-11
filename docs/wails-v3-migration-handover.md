# Wails v3 Migration — Your Action Items

Branch `wails-v3-migration` is complete and locally verified (macOS package +
boot, Linux AppImage/deb/rpm in an Ubuntu 24.04 container incl. apt install +
launch, Windows exe + NSIS installer via Linux makensis, `wails3 dev`,
frontend build/check/tests, storybook smoke tests). These are the things only
you can do, roughly in order.

## 1. Implement the portal update endpoint (blocks in-app updates)

`POST /api/cv1/updates/v3/check` on cloud.mqttviewer.app — full request/
response contract with per-scenario examples in
[update-endpoint-spec.md](update-endpoint-spec.md).

- Same basic-auth as the other `cv1` endpoints; same request body as the old
  `/api/cv1/updates/latest` (machine_id, current_version, os, arch).
- Response returns the GitHub release asset URL + sha256 for the requesting
  platform. CI uploads a sibling `<asset>.sha256` file per asset to read the
  digest from.
- Keep the OLD `/api/cv1/updates/latest` endpoint alive until the v2-era
  installed base has rolled forward — old clients still poll it and can
  update to the new zips (layouts stay compatible).
- Until the endpoint exists, the new app logs a 404 on update checks and
  carries on — nothing breaks.

## 2. Push the branch and do a release dry-run

The branch is local-only. Push, PR, merge, then publish a **prerelease tag**
(e.g. v0.0.X-test) to exercise all three workflows end to end. Things CI will
prove that I could not from this machine:

- **macOS**: gon signing + notarization against the v3-built bundle. Note the
  workflow now strips the taskfile's ad-hoc signature before gon runs
  (`codesign --remove-signature`) — if gon errors anyway, check that step.
- **Windows**: Azure Trusted Signing over `bin/` (portable exe + installer),
  then actually run `MQTT_Viewer_*_installer.exe` on a Windows box once —
  install, launch, uninstall. The NSIS uninstall registry key matches v2's,
  so upgrading over an existing v2 install should be seamless; worth one
  manual confirmation.
- **Linux**: blacksmith runners need the gtk3 deps step to succeed
  (libgtk-3-dev, libwebkit2gtk-4.1-dev, libfuse2, rpm). If the blacksmith
  image is not Ubuntu-based, adjust the apt step.
- Expected release assets per tag: darwin zips (arm64/amd64), windows zip +
  installer, linux zips + AppImage + deb + rpm (amd64/arm64), each with a
  `.sha256` sibling.

## 3. Test the full update swap once the endpoint is live

Install an older build, point it at the portal, click update: built-in Wails
updater window should download, verify the sha256, swap and restart. Test at
minimum macOS (bundle swap + Gatekeeper after re-sign) and Windows
(rename-aside swap). On Linux, a zip-install in your home dir self-updates;
AppImage/deb/rpm correctly show notification-only (they detect the
non-writable binary at runtime).

## 4. Decisions to revisit later

- **GTK4**: we ship `-tags gtk3` (WebKit2GTK 4.1) for Ubuntu 22.04-era
  compatibility. Wails supports this only through v3.0.x — before upgrading
  to wails v3.1, switch to GTK4: drop the tag in
  build/linux/Taskfile.yml, swap nfpm depends to libgtk-4-1 +
  libwebkitgtk-6.0-4, and change CI deps to libgtk-4-dev libwebkitgtk-6.0-dev
  (also remove `-tags gtk3` from the CLI install steps).
- **Windows portable zip** no longer embeds the WebView2 bootstrapper (that
  was a v2 build flag). The installer bundles it; the portable exe assumes
  WebView2 is present (it is on Win10/11). If portable-on-clean-VM matters,
  tell users to grab the installer.
- **Signature verification**: updates are currently digest-verified (sha256).
  The v3 updater also supports ed25519 signing with an embedded public key
  (`updater.Config.PublicKey`) if you want tamper resistance against a
  compromised release pipeline later. There's a stale keypair sitting in
  build/bin/ (gitignored) — generate a fresh one if you go this route.
- **Old v2 cruft deleted**: build_appimage.go, linuxdeploy-plugin-gtk.sh,
  gon configs were updated to the new bin/ paths, justfile `build` now wraps
  `wails3 task package`.

## 5. Known non-blockers

- `makensis` from Homebrew crashes (std::bad_alloc) on macOS arm64 — its own
  bug. The NSIS script itself is valid (verified via preprocessor and by
  building the real installer with Linux makensis). Windows CI is unaffected.
- Pre-existing test failures on `main` (mqtt tests need a local broker,
  cloud/update tests need the portal dev server on localhost:8090, a few
  seed-data FK failures) — identical before and after the migration.
- Dev mode: `wails3 dev` (or `just dev`). Vite runs on port 9245 now.
