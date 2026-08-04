# MQTT Viewer

Cross-platform desktop MQTT client: Go backend + Svelte 5 frontend in a
Wails v3 shell (pinned to `v3.0.0-alpha.98-tui` in go.mod; keep the CLI
and module aligned when bumping, see "The wails3 CLI" below). One
developer runs this product end to end; agents working here are expected
to carry design, engineering, and release work, not just patches.

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

Read the root `AGENTS.md` too. It carries the always-binding writing-style
contract (`docs/WRITING_STYLE.md`) for anything a user reads.

## Commands

Backend (repo root):

```sh
just dev                 # wails3 dev: run the app with hot reload
just test                # go test ./... via tparse
just stub-dist           # create the embedded frontend/dist stub
just new-migration NAME  # atlas migrate diff --env gorm NAME
go build ./... && go vet ./...
```

`just test` runs `stub-dist` first, so it works on a fresh tree. For a
bare `go build ./...` or `go vet ./...`, run the stub once yourself:

```sh
just stub-dist
```

Without it those commands fail with `pattern all:frontend/dist: no
matching files found`. main.go embeds the frontend build, which does not
exist yet on a fresh checkout or new worktree (`frontend/dist` is
gitignored and vite empties it on every build, so a committed
placeholder would not survive). The recipe mirrors the stub
`build/Taskfile.yml`'s `generate:bindings` task creates. A real
`pnpm build` from `frontend/` satisfies the embed too.

Dev-server ports are derived per checkout so parallel agent worktrees
never collide. Once per checkout, run `scripts/dev-ports.sh write-launch`
to generate `.claude/launch.json` (gitignored). See
`docs/MULTI_AGENT_DEV.md`.

### The wails3 CLI

The binding generator ships in the CLI, not the module, so a CLI built
from a different tag than the `go.mod` pin rewrites every file under
`frontend/bindings/` on the next generate. Install the matching one:

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha.98-tui
```

Two traps when checking alignment:

- `wails3 version` prints `v3.0.0-alpha.98`, with no `-tui` suffix,
  because the fork tag never bumped `internal/version/version.txt`.
  That output on its own is not evidence of a mismatch. Read the build
  metadata instead, which should name the pinned tag:

  ```sh
  go version -m "$(which wails3)" | grep -E '^\s+mod\s'
  ```

- The `-tui` tag has since been deleted from `github.com/wailsapp/wails`,
  so cloning the repo and checking the tag out fails. `go install` still
  works, because `proxy.golang.org` serves deleted tags permanently.

To prove alignment, wipe the bindings and regenerate. A clean tree means
the CLI reproduces the committed output byte for byte:

```sh
rm -rf frontend/bindings && wails3 task common:generate:bindings && git status --porcelain
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
- Never push to any branch named `main`. A committed pre-push hook
  enforces this; activate it once per clone with
  `git config core.hooksPath .githooks`. Release pushes set
  `ALLOW_MAIN_PUSH=1`. External PRs from forks often target `main` by
  mistake; retarget with `gh pr edit <n> --base develop`. To push to a
  fork's PR branch, check out with `gh pr checkout <n> -b pr-<n>` (fork
  head branches named `main` otherwise collide with local `main`).
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
  emojis, no em dashes, first person singular, British spelling, terse.
- Changelog: every user-facing feature or fix MUST add a section to the
  unreleased entry in `frontend/src/changelog.ts` in the same PR (the
  `/changelog` skill has the format). If the change traces back to a
  GitHub issue, discussion, or comment, credit the person with a
  `thanks` link to that thread (never to a bare profile unless there is
  no single thread, and never credit the maintainer, samfweb).

## Performance bar

The app must stay smooth while connected to two brokers each flooding
around 2000 msg/s. Run `/perf-check` before merging anything that
touches message handling, the topic tree, history, or the graph view.
This bar exists because heavy public brokers (test.mosquitto.org) are a
core use case.

## Adversarial review

"Adversarial review" here always means the same thing. Never review your
own work in your own context; you will confirm what you already believe.

1. Spawn a **fresh agent** with only the context it needs: the branch or
   diff, the explicit claims being made, and how to run the tests. Do not
   hand it your reasoning, your conclusions, or why you think the work is
   right. Those are what it is meant to attack.
2. Its job is to **disprove**, not to appraise. Brief it to falsify each
   claim, run the tests and benchmarks itself rather than trusting the
   numbers in the description, and hunt for the case that breaks the
   change. "Looks good" is a failed review.
3. **You then judge its findings.** It has less context than you and will
   raise things that are wrong, out of scope, or already handled. Verify
   each one against the code before acting, implement what genuinely
   holds, and say plainly which you rejected and why.

Use the session's top model for the reviewer. Review is judgment, and
judgment is the one thing not worth delegating downward.

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
