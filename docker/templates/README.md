# App store templates

Manifests for submitting `ghcr.io/mqtt-viewer/mqtt-viewer` to the app stores
that surface self-hosted Docker apps. Nothing here is live. These are ready
to send once the image itself is published; see `docs/DOCKER.md`.

Every template says the same thing about auth: the web UI has no built-in
login, so it belongs on a trusted network or behind an authenticating
reverse proxy. Say that wherever the platform lets you write a description.

Before submitting any of these, check and update:

- The image tag. `latest` is fine for Unraid, Portainer and CasaOS, all of
  which resolve it at pull time. Umbrel and Runtipi review conventions
  prefer a pinned version (Umbrel wants a `@sha256:` digest too), so bump
  the placeholder `1.0.0` version strings to the actual release you are
  submitting once the image exists.
- Port numbers that must be unique across a store (Umbrel's `port` field
  in `umbrel/umbrel-app.yml`, Runtipi's `port` in `runtipi/config.json`).
  Pick one that does not collide, using each platform's existing app list.

## Files

### `unraid-template.xml`

Unraid Community Applications template, `Container version="2"` XML.
Declares the repository, the `WebUI` URL pattern
(`http://[IP]:[PORT:8080]/`), a `Port` config entry for 8080 and a `Path`
config entry mapping `/data` to `/mnt/user/appdata/mqtt-viewer`, plus
`Support`, `Overview`, `Category` and `Icon`.

Submit by opening a PR against the Community Applications feed, following
the guide at <https://forums.unraid.net/topic/38619-docker-template-xml-schema/>
and the submission portal at <https://ca.unraid.net/submit>. Community
Applications indexes templates hosted in your own GitHub repo; the usual
path is a PR to a template list such as
<https://github.com/selfhosters/unRAID-CA-templates>, or hosting the XML in
this repo and registering the raw URL with the CA feed.

### `portainer-template.json`

Portainer app template format v3 (`"version": "3"`), one `type: 1`
(container) entry. Declares image, port mapping, the `/data` volume,
restart policy and a `note` field carrying the no-auth warning.

Submit by opening a PR against a community template list Portainer users
point their app template URL at, for example
<https://github.com/portainer/templates> or one of the actively maintained
community forks. Portainer itself does not host a central submission queue;
users add a template URL in Settings, so getting listed means getting into
one of the popular community JSON files. See
<https://docs.portainer.io/advanced/app-templates/build>.

### `casaos/docker-compose.yml`

CasaOS / ZimaOS app store entry: a normal Compose file with a top-level
`x-casaos` extension block (`id`, `main`, `port_map`, `icon`, localized
`title`/`tagline`/`description`, `category`, `architectures`, `repo`,
`support`, `docs`).

Submit by opening a PR against <https://github.com/IceWhaleTech/CasaOS-AppStore>,
adding a new `Apps/mqtt-viewer/` directory containing this compose file plus
an icon asset. Follow
<https://github.com/IceWhaleTech/CasaOS-AppStore/blob/main/docs/quick-start/overview.md>.

### `umbrel/umbrel-app.yml` + `umbrel/docker-compose.yml`

Umbrel app package: the manifest (`umbrel-app.yml`) plus the compose file
wiring an `app_proxy` service in front of the app container, per Umbrel's
current packaging guide. `data/.gitkeep` reserves the persistent data
directory the compose file bind-mounts.

Submit by opening a PR against <https://github.com/getumbrel/umbrel-apps>
with a new top-level `mqtt-viewer/` directory containing these files. See
that repo's `AGENTS.md` and `.claude/skills/umbrel-package-app/SKILL.md` for
the current review checklist, or browse the store at
<https://apps.umbrel.com> to see what a merged app looks like.

### `runtipi/config.json` + `runtipi/docker-compose.yml`

Runtipi app store entry: `config.json` (name, ports, categories,
architectures) paired with a dynamic-compose `docker-compose.yml`
(`x-runtipi` block marking the main service and its internal port).

Submit by opening a PR against <https://github.com/runtipi/runtipi-appstore>
with a new `apps/mqtt-viewer/` directory containing these two files plus a
`metadata/logo.jpg` and `metadata/description.md`. See
<https://runtipi.io/docs/guides/create-your-own-app-store> and the reference
app in <https://github.com/runtipi/example-appstore>.

## Facts these templates encode

- Web UI on port 8080, `WAILS_SERVER_PORT` env var, bound to `0.0.0.0` via
  `WAILS_SERVER_HOST`.
- Single persistent volume at `/data`, `MQTT_VIEWER_DATA_DIR` env var.
- Healthcheck: `GET /health`.
- Runs as uid 1000 inside the container.
- No built-in authentication.
- Multi-arch: `linux/amd64` and `linux/arm64`.
- Licence: GPL-3.0-or-later.
- Homepage: <https://mqttviewer.app>. Repo:
  <https://github.com/mqtt-viewer/mqtt-viewer>. Docs:
  `docs/DOCKER.md`.
