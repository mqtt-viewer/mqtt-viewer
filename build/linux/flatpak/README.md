# Flatpak packaging

This directory builds the Flatpak distribution of MQTT Viewer.

## Files

- `app.mqttviewer.MQTTViewer.yml` - flatpak-builder manifest. Bundles the
  prebuilt binary (see the `create:flatpak` task in `../Taskfile.yml`)
  rather than building from source.
- `app.mqttviewer.MQTTViewer.desktop` - desktop entry.
- `app.mqttviewer.MQTTViewer.metainfo.xml` - AppStream metadata.
  `__VERSION__` and `__DATE__` are substituted at build time.

## Building locally (Linux only)

Flatpak cannot be built on macOS. On a Linux machine with `flatpak` and
`flatpak-builder` installed:

```sh
flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.gnome.Platform//50 org.gnome.Sdk//50
# create:flatpak packages the existing binary, so build it first
wails3 task linux:build ARCH=amd64
wails3 task linux:create:flatpak ARCH=amd64 VERSION=v0.0.0
```

This produces `bin/mqtt-viewer.flatpak`. Install and run it with:

```sh
flatpak install --user bin/mqtt-viewer.flatpak
flatpak run app.mqttviewer.MQTTViewer
```

## CI

- `.github/workflows/flatpak-check.yaml` builds the bundle on pull
  requests that touch this directory, and validates the metadata. This
  is the verification gate, since the bundle cannot be built on macOS.
- `.github/workflows/release-linux.yaml` builds and uploads the
  `.flatpak` bundle as a release asset, and (when signing is configured)
  publishes the hosted auto-updating repo. See `docs/RELEASING.md`.

## In-app updater

Flatpak installs are read-only, so the in-app updater automatically
falls back to notification-only (see `backend/update/canupdate_unix.go`).
Updates are delivered through `flatpak update`.
