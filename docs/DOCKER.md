# MQTT Viewer in Docker (web UI)

MQTT Viewer runs headless as a plain HTTP server. The Docker image serves the
full app to your browser: the real Go backend, live message streaming, the
topic tree, charts, everything the desktop app does apart from a few
desktop-only conveniences listed below. This exists because people asked for
it in [issue #119](https://github.com/mqtt-viewer/mqtt-viewer/issues/119).

## Quick start

```sh
docker run -d --name mqtt-viewer \
  -p 127.0.0.1:8080:8080 \
  -v mqtt-viewer-data:/data \
  ghcr.io/mqtt-viewer/mqtt-viewer:latest
```

Open http://localhost:8080 and you are in the app.

Or with compose, copy [docker/docker-compose.example.yml](../docker/docker-compose.example.yml):

```sh
docker compose -f docker/docker-compose.example.yml up -d
```

### Reaching it from other machines

`127.0.0.1:8080:8080` publishes the port to the host only, which is the right
default because there is no login screen (below). To use MQTT Viewer from
another device on your network, drop the address and publish to every
interface:

```sh
docker run -d --name mqtt-viewer \
  -p 8080:8080 \
  -v mqtt-viewer-data:/data \
  ghcr.io/mqtt-viewer/mqtt-viewer:latest
```

Do that only on a network you trust, or put a proxy in front first. Read the
next section before you do.

## There is no login screen

The web UI has no built-in authentication. Anyone who can reach the port can
use your connections. Saved broker passwords are encrypted at rest in the
database, but the app decrypts them to fill in the connection form, so anyone
who can load the page can read every broker password straight out of the
browser's devtools. Treat reaching the port as equivalent to handing over
your broker credentials.

Run it on a trusted network, or put an authenticating reverse proxy in front
(Caddy, Traefik, nginx, Authelia, a Cloudflare tunnel, whatever you already
run). Do not expose the raw port to the internet.

Auth has to live in the proxy rather than the app because the live event
WebSocket is served by the Wails server layer directly, outside any hook the
app can gate today, so a password check inside the app would still leave the
message stream open.

### One residual risk the proxy has to close

Calls that run backend code go to `/wails/runtime`, and the app rejects those
when the browser says they came from another site. The live event WebSocket
at `/wails/events` is different: it is served by the Wails layer before the
app sees the request, and it accepts cross-origin upgrades.

The consequence is that while you have MQTT Viewer open, another page you
visit in the same browser can open that WebSocket and read your live message
stream. Browsers do not apply the same-origin policy to WebSockets, and they
attach any cached basic-auth credentials to the handshake, so proxy auth does
not close this on its own. It applies even when the port is bound to
`127.0.0.1`, because the attacking page runs in your browser.

If you put a proxy in front, reject cross-origin upgrades there. The Caddy
example below does.

### Worked example: Caddy with basic auth

Caddy sits in front, asks for a username and password, and forwards
everything else to the container. Caddy proxies WebSocket upgrades by
default, so the `/wails/events` stream that carries live messages works
without extra config.

Generate a password hash first:

```sh
docker run --rm -it caddy:2 caddy hash-password
```

`Caddyfile` (replace the domain and the hash in both places):

```
mqtt.example.com {
	basic_auth {
		admin REPLACE_WITH_HASH
	}

	# Reject WebSocket upgrades sent from another site. Browsers do not apply
	# the same-origin policy to WebSockets and they attach cached basic-auth
	# credentials to the handshake, so basic auth alone leaves the live
	# message stream readable by any page you visit. See the residual risk
	# above.
	@cross_origin_ws {
		header Connection *Upgrade*
		not header Origin https://mqtt.example.com
	}
	respond @cross_origin_ws 403

	reverse_proxy mqtt-viewer:8080
}
```

With a real domain Caddy also provisions TLS for you. On a LAN without a
domain, use `:80` as the site address instead and accept that there is no
TLS. Match the `Origin` header to whatever address you actually browse to,
for example `http://192.168.1.20`, or the upgrade matcher will block your own
session too.

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
| `MQTT_VIEWER_DATA_DIR` | `/data` | Where the SQLite database and Sparkplug proto files live. Leave it alone in Docker, see below. |

Do not change `MQTT_VIEWER_DATA_DIR` in the container. The machine id that
saved broker passwords are encrypted with lives at `/data/machine-id`, and
the image's `/etc/machine-id` symlink is baked in at that path. Point the
data dir somewhere else and the database moves while the machine id does
not, so a fresh volume gets a fresh id and every saved password silently
stops decrypting. Mount your volume at `/data` instead.

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
  -p 127.0.0.1:8080:8080 \
  -v mqtt-viewer-data:/data \
  -v ./certs:/certs:ro \
  ghcr.io/mqtt-viewer/mqtt-viewer:latest
```

Then set the CA path to `/certs/ca.pem` (or wherever you mounted it) in the
connection settings.

## What differs from the desktop app

- Exports download through the browser instead of a save dialog.
- Chart pop-outs open as browser tabs.
- Broker status and device monitoring controls are hidden for now. They need an
  in-page route before they can work in the browser.
- No auto-update. Update by pulling a new image:
  `docker pull ghcr.io/mqtt-viewer/mqtt-viewer:latest` and recreate the
  container. Your data survives in the volume.
- Certificate paths are typed, not picked (see above).
- **Every browser tab shares one session.** There is a single backend, so
  connecting or disconnecting in one tab does it for all of them, and panel
  sizes, open tabs and sort order are last-writer-wins across windows. Two
  people using it at once will see each other's actions. This is fine for one
  person on two machines and surprising for anything more.
- **Copying to the clipboard needs a secure context.** Browsers only allow
  clipboard writes over HTTPS or on `localhost`, so "Copy topic path" and the
  other copy actions silently do nothing when you browse to a plain-HTTP LAN
  address. Put TLS in front (the Caddy example does this for you with a real
  domain) if you need them.

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
docker run -d -p 127.0.0.1:8080:8080 -v mqtt-viewer-data:/data mqtt-viewer:local
```

The build compiles the frontend and a static Go binary in intermediate
stages; you need nothing installed beyond Docker. `--build-arg VERSION=x.y.z`
stamps the version shown in the app; keep a `-dev` suffix on it. A version
without one marks the binary as an official release build, and the build then
demands the signing and portal secrets only the release workflow has.

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
