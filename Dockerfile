# MQTT Viewer web/server image.
#
# Three stages: build the Svelte frontend, compile a static Go binary in
# server mode (Wails v3's headless HTTP server, see backend/env and the
# `server` build tag), then assemble a minimal runtime image.
#
# Build:
#   docker build -t mqtt-viewer:local .
#   docker build --build-arg VERSION=1.2.3-dev -t mqtt-viewer:local .
#
# Stamping a release VERSION (one containing neither "-dev" nor
# "-docker-local") requires the three BuildKit secrets the release workflow
# passes; see the ldflags step below.
#
# See docs/DOCKER.md for run instructions and docker/docker-compose.example.yml
# for a ready-made compose service.

# ---------------------------------------------------------------------------
# Stage 1: frontend build
# ---------------------------------------------------------------------------
# Pinned to BUILDPLATFORM: the output is architecture-independent static
# assets, so there is no reason to run pnpm/node under arm64 emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend

WORKDIR /src/frontend

# Copy just the manifest + lockfile first so `pnpm install` is cached across
# rebuilds that only touch application source.
COPY frontend/package.json frontend/pnpm-lock.yaml ./

# `packageManager` in package.json pins the exact pnpm version; prepare it
# explicitly via corepack rather than relying on corepack's own network
# lookup on first `pnpm` invocation.
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

RUN pnpm install --frozen-lockfile

COPY frontend/ ./

RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 2: Go build
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build

ARG TARGETOS
ARG TARGETARCH
ARG VERSION=0.0.0-docker-local

WORKDIR /src

# Dependency layer, cached independently of application source changes.
COPY go.mod go.sum ./
RUN go mod download

# Application source. Generated Wails bindings (frontend/bindings) are
# committed in the repo, so no wails3 CLI is needed to build the server
# binary.
COPY . .

# Built frontend from stage 1, in the location //go:embed all:frontend/dist
# in main.go expects.
COPY --from=frontend /src/frontend/dist ./frontend/dist

# CGO_ENABLED=0: the SQLite driver (glebarez, pure Go) makes a fully static
# binary possible, so we cross-compile natively for TARGETOS/TARGETARCH
# without QEMU (Go's own cross-compiler handles it).
#
# -tags server,production: `server` swaps Wails' platform layer for its
# headless HTTP server (see vendored wails/v3/pkg/application/application_server.go);
# `production` is a real Wails build tag too (disables dev asset/logger
# middleware), matching the desktop release build's code paths.
#
# Version ldflags mirror .github/workflows/release-linux.yaml.
#
# A VERSION containing "-dev" or "-docker-local" (the default) is a local
# build: secrets are optional and the binary falls back to the checked-in dev
# values in backend/env/env.go, with env.IsDev true so it never talks to the
# production portal. Any other VERSION is a release build, and a missing
# secret there would ship those same dev values with IsDev false, silently
# pointing at production. Fail the build instead.
RUN --mount=type=secret,id=machine_id_secret \
    --mount=type=secret,id=cloud_username \
    --mount=type=secret,id=cloud_password \
    set -eu; \
    case "${VERSION}" in \
        *-dev*|*-docker-local*) ;; \
        *) \
            for s in machine_id_secret cloud_username cloud_password; do \
                if [ ! -s "/run/secrets/$s" ]; then \
                    echo "ERROR: VERSION=${VERSION} is a release build but the BuildKit secret '$s' is missing or empty." >&2; \
                    echo "Pass all three (machine_id_secret, cloud_username, cloud_password), or stamp a VERSION containing -dev to build without them." >&2; \
                    exit 1; \
                fi; \
            done ;; \
    esac; \
    LDFLAGS="-s -w -X mqtt-viewer/backend/env.Version=${VERSION}"; \
    if [ -s /run/secrets/machine_id_secret ]; then \
        LDFLAGS="${LDFLAGS} -X mqtt-viewer/backend/env.MachineIdProtectString=$(cat /run/secrets/machine_id_secret)"; \
    fi; \
    if [ -s /run/secrets/cloud_username ]; then \
        LDFLAGS="${LDFLAGS} -X mqtt-viewer/backend/env.CloudUsername=$(cat /run/secrets/cloud_username)"; \
    fi; \
    if [ -s /run/secrets/cloud_password ]; then \
        LDFLAGS="${LDFLAGS} -X mqtt-viewer/backend/env.CloudPassword=$(cat /run/secrets/cloud_password)"; \
    fi; \
    CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
        go build -tags server,production -trimpath -ldflags "${LDFLAGS}" -o /out/mqtt-viewer .

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM alpine:3

# ca-certificates: outbound TLS to MQTT brokers and the cloud portal.
# tzdata: local time formatting.
# wget: used by the HEALTHCHECK below (curl is not in the default alpine set).
RUN apk add --no-cache ca-certificates tzdata wget

RUN addgroup -g 1000 mqttviewer \
    && adduser -D -u 1000 -G mqttviewer -h /home/mqttviewer mqttviewer \
    && mkdir -p /data \
    && chown -R mqttviewer:mqttviewer /data

# denisbrodbeck/machineid (backend/env init) reads /etc/machine-id, falling
# back to /var/lib/dbus/machine-id. Both are symlinked onto a single file
# under /data so the machine id (and everything encrypted with it, e.g.
# saved broker passwords) survives container recreation as long as the /data
# volume persists. docker/entrypoint.sh creates the target file if missing.
RUN ln -s /data/machine-id /etc/machine-id \
    && mkdir -p /var/lib/dbus \
    && ln -s /data/machine-id /var/lib/dbus/machine-id

COPY --from=build /out/mqtt-viewer /usr/local/bin/mqtt-viewer
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV WAILS_SERVER_HOST=0.0.0.0 \
    WAILS_SERVER_PORT=8080 \
    MQTT_VIEWER_DATA_DIR=/data

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O- "http://127.0.0.1:${WAILS_SERVER_PORT}/health" || exit 1

USER mqttviewer

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/local/bin/mqtt-viewer"]
