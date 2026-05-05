# MQTT Viewer agent notes

## Wails v3 commands

- Install frontend dependencies: `cd /home/runner/work/mqtt-viewer/mqtt-viewer/frontend && pnpm install --frozen-lockfile`
- Generate Wails v3 bindings: `cd /home/runner/work/mqtt-viewer/mqtt-viewer && wails3 generate bindings -clean=true -ts`
- Build the frontend: `cd /home/runner/work/mqtt-viewer/mqtt-viewer/frontend && pnpm build`
- Build the Linux desktop app: `cd /home/runner/work/mqtt-viewer/mqtt-viewer && wails3 build VERSION="v0.0.1-dev"`
- Package Linux AppImage: `cd /home/runner/work/mqtt-viewer/mqtt-viewer && wails3 package VERSION="v0.0.1-dev"`

## Tests and checks

- Go tests: `cd /home/runner/work/mqtt-viewer/mqtt-viewer && go test ./...`
- Frontend tests: `cd /home/runner/work/mqtt-viewer/mqtt-viewer/frontend && pnpm test`
- Frontend type check: `cd /home/runner/work/mqtt-viewer/mqtt-viewer/frontend && pnpm check`

Some Go tests expect local MQTT/update services to be running. If those services are unavailable, prefer targeted package tests for changed backend code plus a Wails build check.
