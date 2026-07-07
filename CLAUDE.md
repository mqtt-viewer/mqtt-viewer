# MQTT Viewer

Cross-platform desktop MQTT client: Go backend + Svelte 5 frontend in a
Wails v3 shell (pinned to `v3.0.0-alpha.98-tui` in go.mod; keep the CLI
and module aligned when bumping). One developer runs this product end to
end; agents working here are expected to carry design, engineering, and
release work, not just patches.

## Repo map

| Path | What |
| --- | --- |
| `backend/app/` | Wails service layer: connections, subscriptions, tabs, collections, publish history, export |
| `backend/mqtt/` | MQTT client lifecycle: manager state machine, buffers, history with memory budgeting, stats |
| `backend/db/` + `loader/` + `atlas.hcl` | GORM + SQLite; SQL-first Atlas migrations generated from the models `loader/main.go` registers |
| `backend/protobuf/` | Protobuf and Sparkplug (v1a/v1b) codec + descriptor registry |
| `events/` + `backend/event-runtime/` | Event name constants and the Wails event wrapper (global + per-connection events) |
| `frontend/src/` | Svelte app: `stores/` for global state, `components/` + `views/` as the design-system library |
| `frontend/bindings/` | Generated Go-to-TS bindings. Never edit; regenerate with `wails3 task common:generate:bindings` |
| `build/` | Wails Taskfiles per platform, dev config, icons |
| `scripts/` | `mqtt-flood.py` (load harness), `mqtt-sim.py` (realistic traffic) |
| `docs/` | RELEASING.md, WRITING_STYLE.md, design-system docs, specs |

Read `frontend/AGENTS.md` before touching any frontend component, story,
or `.spec.json`. It is the design-system contract and its rules are
enforced by CI (`design-system.yml` runs `pnpm ds:validate` and
`pnpm test-storybook`).

## Commands

Backend (repo root):

```sh
just dev                 # wails3 dev: run the app with hot reload
just test                # go test ./... via tparse
just new-migration NAME  # atlas migrate diff --env gorm NAME
go build ./... && go vet ./...
```

Frontend (from `frontend/`, pnpm version pinned in package.json):

```sh
pnpm check         # svelte-check, keep at 0 errors
pnpm test:run      # vitest unit tests
pnpm test-storybook
pnpm ds:validate   # design-system CI gate
pnpm storybook     # port 6006
```

Full pre-merge bar for `develop`: `go build ./...`, `go vet ./...`,
`just test`, `pnpm check`, `pnpm test:run`, `pnpm build`,
`pnpm ds:validate`, `pnpm test-storybook`.

## Conventions

- Branch model: feature branches PR into `develop`; `main` only moves by
  fast-forward from `develop` at release time (`/release` skill,
  `docs/RELEASING.md`).
- Commits: conventional prefixes with optional scope,
  `feat(topic-graph): ...`, `fix:`, `perf:`, `chore:`, `docs:`.
- Svelte: the codebase runs Svelte 5 but components use legacy syntax
  (`export let`, `on:click`). Do not rewrite to runes unless the task is
  that migration.
- Styling: Tailwind token utilities only (`bg-primary`), never raw hex.
  Canonical token list is generated into
  `frontend/src/design-system/design-tokens.json`.
- Database changes: edit the GORM model, register it in
  `loader/main.go` if new, then `just new-migration <name>`. Never
  hand-edit applied migrations.
- Backend tests use `getTestApp(t)` with golden dirs under
  `backend/app/_test/<TestName>/`; keep new tests in that pattern.
- Anything a user reads follows `docs/WRITING_STYLE.md`. Hard rules: no
  emojis, no em dashes, first person singular, British spelling.

## Performance bar

The app must stay smooth while connected to two brokers each flooding
around 2000 msg/s. Run `/perf-check` before merging anything that
touches message handling, the topic tree, history, or the graph view.
This bar exists because heavy public brokers (test.mosquitto.org) are a
core use case.

## Releases and the portal

`docs/RELEASING.md` is the runbook; the `/release` skill drives it.
Publishing a GitHub release is safe by itself: nothing reaches users
until the `released` toggle is flipped in the portal admin. The portal
(licensing, payments, update checks) is the private
`mqtt-viewer/cloud` repo; its README is the operations handoff and
holds everything that must not be public, including signing account
details and the operator access list.

## Skills

- `/release` - publish a release end to end, up to the manual go-live
- `/changelog` - gather and stage "What's new" notes
- `/perf-check` - two-broker flood verification
- `/ds-add-component`, `/ds-figma-handover`, `/ds-implement-handover` -
  design-system loop (see `frontend/AGENTS.md`)
