# `develop` → `main` pre-merge checklist

`develop` integrates the v2 feature work **and** the Wails v3 migration. It
builds and the v3 app boots, but a few things can only be verified or actioned
by you (signing secrets, hardware, the native window, release infra) before
this is safe to ship to `main`.

## What's already on `develop`

- Sidebar **collections** + **connection controls** (header bar removed,
  connection details now a dialog), plus their review fixes.
- **fix/11** remember right panel width.
- **fix/security-alerts** dependency bumps (paho.mqtt 1.5.1, golang.org/x
  crypto/net/sync/text, edwards25519), go 1.25.
- **Wails v2 → v3** migration (alpha.98), bindings regenerated, all 47 App
  methods incl. collections CRUD.

Verified green: `go build ./...`, `go vet`, `pnpm check` (0 errors),
`pnpm test:run` (27), `pnpm build`, `pnpm ds:validate`, `pnpm test-storybook`
(99/99). `wails3 dev` compiles, launches `MQTT Viewer.dev.app`, connects DB,
runs migrations — no panic.

## Do before merging to main

### 1. Hands-on smoke test in the real v3 window
Automated checks pass and the app boots, but the native window was **not**
click-tested (the screen-access approval dialog needs you present). Run
`wails3 dev` (or `just dev`) against a local broker (`mosquitto -p 1883`) and
walk through:
- [ ] Connect / disconnect from the **sidebar** dropdown; status dot + latency.
- [ ] Create a connection → details **dialog** auto-opens; fields disabled
      while connected.
- [ ] Collections: create (global + connection), add message from history,
      rename, move, delete; saved-message scratch-edit → Modified → Save.
- [ ] Publish a message → appears in topic tree + history.
- [ ] Search modal (Collections + Previously published sections, highlight).
- [ ] Sidebar collapse rail; "Not connected" landing on a fresh tab.
- [ ] Resize right panel, reopen — width remembered (fix/11).

### 2. Confirm the v3 UpdateDialog behaviour is acceptable
The in-app "updating…" spinner is **gone** in v3 — the native Wails updater
window now handles download/verify/swap/restart (intentional, from the v3
branch). Decide if that UX is fine or needs a tweak.
- [ ] Reviewed update flow UX.

### 3. Release dry-run (only you can do — secrets + signing + hardware)
Per `docs/wails-v3-migration-handover.md`:
- [ ] Set portal `CI_RELEASES_USERNAME` / `CI_RELEASES_PASSWORD` secrets
      (fly + GitHub Actions); endpoint fails closed without them.
- [ ] Deploy the cloud `updates-v3` endpoint branch.
- [ ] Publish a **prerelease tag** (e.g. `v0.0.X-test`) to exercise all three
      release workflows end-to-end:
  - [ ] macOS: gon signing + notarization on the v3 bundle.
  - [ ] Windows: Azure Trusted Signing; install/launch/uninstall the
        installer on a real Windows box; confirm upgrade-over-v2 works.
  - [ ] Linux: blacksmith gtk3 deps step; AppImage/deb/rpm + zips produced.
- [ ] Full update-swap test: install an older build, point at the portal,
      click update → download → sha256 verify → swap → relaunch (mac + win
      at minimum).

### 4. Housekeeping
- [ ] go.mod still has a commented-out Windows `replace` directive
      (`// replace github.com/wailsapp/wails/v2 ... => C:\Users\sam\...`) —
      inert, but remove it if you want a clean file.
- [ ] go.mod pins `wails/v3 v3.0.0-alpha.98-tui` (the variant exposing the
      updater pkg); CLI is `alpha.98`. They build/boot together — confirm
      you're happy pinning the `-tui` build, or align both.
- [ ] Decide GTK4 timing (handover §4) before any future wails v3.1 bump.

### 5. Merge
- [ ] Re-run the full check suite on `develop` head once more.
- [ ] `git checkout main && git merge --ff-only develop` (develop is ahead of
      main with no divergence, so a fast-forward works), or open a
      `develop → main` PR if you want CI to gate it.
- [ ] Tag a real release once the dry-run is clean.
