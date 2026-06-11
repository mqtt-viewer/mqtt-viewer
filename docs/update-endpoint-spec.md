# Update Endpoint Specification (Wails v3 updater)

The desktop app (>= the Wails v3 migration) checks for updates by POSTing to a
single portal endpoint. The portal decides which release applies to the
requesting machine and returns links to **GitHub release assets**. The app's
built-in Wails v3 updater then downloads the asset, verifies its SHA-256
digest, swaps the binary atomically and relaunches.

This replaces the previous `/api/cv1/updates/latest` flow (fynelabs/selfupdate
based). The request body is unchanged; the response shape is new.

## Endpoint

```
POST /api/cv1/updates/v3/check
```

- Host: `https://cloud.mqttviewer.app` (prod) / `http://localhost:8090` (dev)
- Auth: same HTTP Basic auth as the other `cv1` endpoints (the app sends its
  embedded cloud credentials via the shared resty client).
- Content-Type: `application/json`

## Request body

```json
{
  "machine_id": "hashed-machine-id",
  "current_version": "v1.4.2",
  "os": "darwin",
  "arch": "arm64"
}
```

| Field             | Notes                                                          |
| ----------------- | -------------------------------------------------------------- |
| `machine_id`      | Anonymised machine hash, same value as the old endpoint.       |
| `current_version` | App version, may or may not carry a `v` prefix — treat both.   |
| `os`              | `darwin` \| `windows` \| `linux` (Go `runtime.GOOS`).          |
| `arch`            | `amd64` \| `arm64` (Go `runtime.GOARCH`).                      |

The same endpoint is called twice per update: once by the periodic
notification check and once by the updater itself when the user clicks
install. Responses must be deterministic for identical requests.

## Response body (HTTP 200)

### Up to date

```json
{
  "up_to_date": true,
  "latest_version": "v1.4.2"
}
```

### Update available (licensed, self-updatable)

```json
{
  "up_to_date": false,
  "latest_version": "v1.5.0",
  "can_update": true,
  "release_notes": "Markdown release notes shown in the updater window",
  "published_at": "2026-06-01T00:00:00Z",
  "notification_text": "v1.5.0 of MQTT Viewer is available",
  "notification_url": "",
  "artifact": {
    "name": "MQTT_Viewer_v1.5.0_darwin_arm64.zip",
    "url": "https://github.com/mqtt-viewer/mqtt-viewer/releases/download/v1.5.0/MQTT_Viewer_v1.5.0_darwin_arm64.zip",
    "size": 28734231,
    "sha256": "hex-encoded sha256 of the asset"
  }
}
```

### Update available but the license does not cover it

```json
{
  "up_to_date": false,
  "latest_version": "v2.0.0",
  "can_update": false,
  "release_notes": "",
  "notification_text": "v2.0.0 is available but your license has expired. Click here to renew.",
  "notification_url": "https://mqttviewer.app/renew"
}
```

`can_update: false` guarantees the app never downloads/installs the release;
it only shows the notification (with `notification_url` as the click target).

| Field               | Required | Notes                                                                 |
| ------------------- | -------- | --------------------------------------------------------------------- |
| `up_to_date`        | yes      | `true` short-circuits everything else.                                |
| `latest_version`    | yes      | Tag of the latest applicable release, `v`-prefixed.                   |
| `can_update`        | yes      | License gate. `false` = notify only.                                  |
| `release_notes`     | no       | Markdown. Rendered in the Wails updater window (GFM subset).          |
| `published_at`      | no       | RFC 3339.                                                             |
| `notification_text` | no       | Custom in-app notification copy.                                      |
| `notification_url`  | no       | Where a notification click goes when the app can't self-update.       |
| `artifact`          | when `can_update` | The asset matching the request's `os`/`arch` (see below).    |
| `artifact.sha256`   | strongly recommended | Hex digest; the updater verifies the download against it. |

Any non-200 status is treated as "check failed" (the app logs it and tries
again on the next cycle).

## Choosing the artifact

CI uploads these assets to each GitHub release (tag `vX.Y.Z`):

| `os`      | `arch`  | Asset to return                              | Contents                  |
| --------- | ------- | -------------------------------------------- | ------------------------- |
| `darwin`  | `arm64` | `MQTT_Viewer_{tag}_darwin_arm64.zip`         | `MQTT Viewer.app` bundle  |
| `darwin`  | `amd64` | `MQTT_Viewer_{tag}_darwin_amd64.zip`         | `MQTT Viewer.app` bundle  |
| `windows` | `amd64` | `MQTT_Viewer_{tag}_windows_amd64.zip`        | `mqtt-viewer.exe`         |
| `linux`   | `amd64` | `MQTT_Viewer_{tag}_linux_amd64.zip`          | `mqtt-viewer` binary      |
| `linux`   | `arm64` | `MQTT_Viewer_{tag}_linux_arm64.zip`          | `mqtt-viewer` binary      |

(The release also carries `MQTT_Viewer_{tag}_windows_amd64_installer.exe`,
`MQTT_Viewer_{tag}_linux_{arch}.AppImage`, `.deb` and `.rpm` assets for
first-time installs — the updater never consumes those. AppImage, deb and rpm
installs detect that their binary is not user-writable and fall back to a
notification pointing at `notification_url`, defaulting to the GitHub
releases page.)

CI also uploads a sibling `<asset>.sha256` file for every asset (`sha256sum`
format: `<hex>  <filename>`). The portal should read the one matching the
asset it returns and serve the digest in `artifact.sha256`.

The zip must contain exactly **one top-level entry** (the `.app` bundle, the
`.exe`, or the binary) — the Wails updater rejects multi-entry archives.

## Versioning rules

- Compare versions semver-style; ignore any `v` prefix on either side.
- If `current_version` >= latest, return `up_to_date: true`.
- The app additionally treats `latest_version == current_version` as
  up-to-date regardless of `up_to_date`.

## Migration note for old (v2-era) clients

Old clients keep calling `POST /api/cv1/updates/latest` with the same request
body and expect the old response shape (`update_url` pointing at a zip). Keep
that endpoint alive until the installed base has rolled forward; it can serve
the same GitHub asset URL in `update_url`. The old in-app updater replaces
just the executable inside the existing install, which remains compatible
with the new zip layouts above.
