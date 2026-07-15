# Submitting MQTT Viewer to Flathub

This is the runbook for listing MQTT Viewer on Flathub. Flathub then hosts
and auto-updates the app for users, which makes the self-hosted repository
redundant. It is a separate track from the self-hosted repo and is best done
against a real published release.

## What makes this different from our own build

- MQTT Viewer is proprietary, so the Flathub manifest cannot build from
  source. It uses the prebuilt-binary pattern: download the released binary
  from a GitHub release, pinned by `sha256`, per architecture. This is a
  supported and common pattern on Flathub.
- Flathub builds run offline, so every input is pinned by checksum. Nothing
  is fetched at build time except the declared sources.
- The app-id `app.mqttviewer.MQTTViewer` matches the `mqttviewer.app` domain,
  which we control. Flathub verifies this during onboarding.

## One-time prerequisites

1. A published release whose Linux assets are downloadable, i.e.
   `MQTT_Viewer_<tag>_linux_amd64.zip` and `..._arm64.zip` on the GitHub
   release. These already exist (see `release-linux.yaml`).
2. Confirm the licence position. Flathub lists the app's `project_license`
   (currently `MIT` in the metainfo). If the shipped product is proprietary,
   set the metainfo `project_license` to `LicenseRef-proprietary` before
   submitting, otherwise the store page will misdescribe it.

## Submission steps

1. Fork `https://github.com/flathub/flathub` and create a branch off the
   `new-pr` branch (not `master`).
2. Add a single file, `app.mqttviewer.MQTTViewer.yaml` (the template below),
   plus the `.desktop` and `.metainfo.xml` from this directory. Fill in the
   real version, download URLs and `sha256` sums for both architectures.
3. Open a pull request against the `new-pr` branch. The Flathub build bot
   builds it and posts results; fix anything it flags.
4. A reviewer checks it. Respond to review comments. On merge, Flathub
   creates the `flathub/app.mqttviewer.MQTTViewer` repository and you become
   its maintainer.
5. Verify domain ownership when prompted (via the Flathub developer portal,
   using the `mqttviewer.app` website or a login provider).

## Keeping it updated automatically

Add `x-checker-data` to each binary source so Flathub's external-data-checker
bot opens an update PR when a new GitHub release appears. Merging that PR
ships the update. Example for the amd64 source:

```yaml
    x-checker-data:
      type: json
      url: https://api.github.com/repos/mqtt-viewer/mqtt-viewer/releases/latest
      version-query: .tag_name | sub("^v"; "")
      url-query: >-
        .assets[] | select(.name | test("linux_amd64\\.zip$")) |
        .browser_download_url
```

## Manifest template

Compute the sums with `sha256sum` on the release assets, then paste them in.

```yaml
app-id: app.mqttviewer.MQTTViewer
runtime: org.gnome.Platform
runtime-version: '50'
sdk: org.gnome.Sdk
command: mqtt-viewer

finish-args:
  - --share=network
  - --share=ipc
  - --socket=wayland
  - --socket=fallback-x11
  - --device=dri
  - --filesystem=home

modules:
  - name: mqtt-viewer
    buildsystem: simple
    build-commands:
      - install -Dm755 mqtt-viewer /app/bin/mqtt-viewer
      - install -Dm644 app.mqttviewer.MQTTViewer.desktop /app/share/applications/app.mqttviewer.MQTTViewer.desktop
      - install -Dm644 app.mqttviewer.MQTTViewer.png /app/share/icons/hicolor/512x512/apps/app.mqttviewer.MQTTViewer.png
      - install -Dm644 app.mqttviewer.MQTTViewer.metainfo.xml /app/share/metainfo/app.mqttviewer.MQTTViewer.metainfo.xml
    sources:
      - type: archive
        only-arches: [x86_64]
        url: https://github.com/mqtt-viewer/mqtt-viewer/releases/download/vX.Y.Z/MQTT_Viewer_vX.Y.Z_linux_amd64.zip
        sha256: REPLACE_WITH_AMD64_ZIP_SHA256
      - type: archive
        only-arches: [aarch64]
        url: https://github.com/mqtt-viewer/mqtt-viewer/releases/download/vX.Y.Z/MQTT_Viewer_vX.Y.Z_linux_arm64.zip
        sha256: REPLACE_WITH_ARM64_ZIP_SHA256
      - type: file
        path: app.mqttviewer.MQTTViewer.desktop
      - type: file
        path: app.mqttviewer.MQTTViewer.png
      - type: file
        path: app.mqttviewer.MQTTViewer.metainfo.xml
```

Note: the release `.zip` contains the `mqtt-viewer` binary at its root, so
`type: archive` extracts it into the build directory ready for `install`.
Copy `build/appicon.png` to `app.mqttviewer.MQTTViewer.png` in the Flathub
repo, since the manifest installs it by that name.
