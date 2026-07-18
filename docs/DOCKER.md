# MQTT Viewer in Docker (web UI)

MQTT Viewer runs headless as a plain HTTP server. The Docker image serves the
full app to your browser: the real Go backend, live message streaming, the
topic tree, charts, everything the desktop app does apart from a few
desktop-only conveniences listed below. This exists because people asked for
it in [issue #119](https://github.com/mqtt-viewer/mqtt-viewer/issues/119).

## Quick start

```sh
docker run -d --name mqtt-viewer \
  -p 8080:8080 \
  -v mqtt-viewer-data:/data \
  ghcr.io/mqtt-viewer/mqtt-viewer:latest
```

Open http://localhost:8080 and you are in the app.

Or with compose, copy [docker/docker-compose.example.yml](../docker/docker-compose.example.yml):

```sh
docker compose -f docker/docker-compose.example.yml up -d
```

## There is no login screen

The web UI has no built-in authentication. Anyone who can reach the port can
use your connections, including saved (encrypted) broker credentials. Run it
on a trusted network, or put an authenticating reverse proxy in front
(Caddy, Traefik, nginx, Authelia, a Cloudflare tunnel, whatever you already
run). Do not expose the raw port to the internet.

Auth has to live in the proxy rather than the app because the live event
WebSocket is served by the Wails server layer directly, outside any hook the
app can gate today, so a password check inside the app would still leave the
message stream open.

### Worked example: Caddy with basic auth

Caddy sits in front, asks for a username and password, and forwards
everything else to the container. Caddy proxies WebSocket upgrades by
default, so the `/wails/events` stream that carries live messages works
without extra config.

Generate a password hash first:

```sh
docker run --rm -it caddy:2 caddy hash-password
```

`Caddyfile` (replace the domain and the hash):

```
mqtt.example.com {
	basic_auth {
		admin REPLACE_WITH_HASH
	}
	reverse_proxy mqtt-viewer:8080
}
```

With a real domain Caddy also provisions TLS for you. On a LAN without a
domain, use `:80` as the site address instead and accept that there is no
TLS.

`docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config

  mqtt-viewer:
    image: ghcr.io/mqtt-viewer/mqtt-viewer:latest
    restart: unless-stopped
    volumes:
      - mqtt-viewer-data:/data
    # No ports: only Caddy can reach it on the compose network.

volumes:
  caddy-data:
  caddy-config:
  mqtt-viewer-data:
```

Note the mqtt-viewer service publishes no ports. The only way in is through
Caddy, which is the point.

## Configuration

| Env var | Default | What it does |
| --- | --- | --- |
| `WAILS_SERVER_PORT` | `8080` | Port the HTTP server listens on inside the container. |
| `WAILS_SERVER_HOST` | `0.0.0.0` | Bind address. Leave it alone in Docker. |
| `MQTT_VIEWER_DATA_DIR` | `/data` | Where the SQLite database, machine id and Sparkplug proto files live. |

| Path | What it holds |
| --- | --- |
| `/data` | All persistent state. Mount a volume here or your connections vanish with the container. |

The container runs as uid 1000 (`mqttviewer`). Named volumes work out of the
box. If you bind-mount a host directory instead, make it writable for
uid 1000: `chown -R 1000:1000 ./mqtt-viewer-data`.

`GET /health` returns `{"status":"ok"}` and is wired up as the image's
healthcheck.

## TLS certificates for broker connections

The connection form's certificate picker is a native file dialog on desktop.
In the browser you type a path instead, and that path is resolved inside the
container. Mount your certs and reference them by their in-container path:

```sh
docker run -d \
  -p 8080:8080 \
  -v mqtt-viewer-data:/data \
  -v ./certs:/certs:ro \
  ghcr.io/mqtt-viewer/mqtt-viewer:latest
```

Then set the CA path to `/certs/ca.pem` (or wherever you mounted it) in the
connection settings.

## What differs from the desktop app

- Exports download through the browser instead of a save dialog.
- Pop-out chart and broker status windows open as browser tabs.
- No auto-update. Update by pulling a new image:
  `docker pull ghcr.io/mqtt-viewer/mqtt-viewer:latest` and recreate the
  container. Your data survives in the volume.
- Certificate paths are typed, not picked (see above).

Everything else is the same code path as the desktop app.

## Updating

```sh
docker pull ghcr.io/mqtt-viewer/mqtt-viewer:latest
docker stop mqtt-viewer && docker rm mqtt-viewer
# then run the same docker run command as before
```

Or `docker compose pull && docker compose up -d` if you use compose. The
database schema migrates forward automatically on start. Downgrading to an
older image after a migration is not supported, same as the desktop app.

## Building the image yourself

```sh
docker build -t mqtt-viewer:local .
docker run -d -p 8080:8080 -v mqtt-viewer-data:/data mqtt-viewer:local
```

The build compiles the frontend and a static Go binary in intermediate
stages; you need nothing installed beyond Docker. `--build-arg VERSION=x.y.z`
stamps the version shown in the app.

## Home Assistant and other platforms

The image is a normal web app on a single port with a single `/data` volume,
which is the shape Home Assistant add-ons, Unraid templates, Portainer
templates and similar app stores expect. A Home Assistant add-on needs
ingress support (serving the UI under a path prefix), which the app does not
handle yet. If you want this, say so in
[issue #119](https://github.com/mqtt-viewer/mqtt-viewer/issues/119) so I know
to prioritise it.

## App store templates

Ready-to-submit manifests for Unraid Community Applications, Portainer,
CasaOS, Umbrel and Runtipi live in
[docker/templates](../docker/templates/README.md). Nothing there is live
yet: I submit them to each platform once the image itself is published, and
that README has the submission URL and process for each one.

## Troubleshooting

- **Container exits immediately**: check `docker logs mqtt-viewer`. A
  read-only or root-owned `/data` is the usual cause.
- **UI loads but nothing updates live**: the browser could not open the
  event WebSocket. Check that your reverse proxy passes WebSocket upgrades
  through to the container.
- **Saved passwords stopped decrypting**: the machine id in
  `/data/machine-id` is part of the encryption key. If you deleted the
  volume, saved credentials cannot be recovered; re-enter them.
