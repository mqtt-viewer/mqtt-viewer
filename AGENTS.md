# Agent guide

Start with `CLAUDE.md` in this directory: repo map, commands, conventions,
performance bar, release process, and the skills index. For frontend and
design-system work, `frontend/AGENTS.md` is the binding contract.

## Driving the app from a browser (agents)

Short version: **a normal `wails3 dev` run is NOT drivable from an external
browser.** The UI renders if you open the Vite port (e.g. `http://localhost:9392`),
but every runtime/binding call fails with `Error at runtimeCallWithID`. To drive
the real backend from a browser, build the app in Wails **server mode** instead —
`scripts/serve-browser.sh`.

### Why the Vite port doesn't work

- The bundled `@wailsio/runtime` sends every call as `POST {origin}/wails/runtime`
  with headers `x-wails-client-id` (a nanoid) and, only when a window name is set,
  `x-wails-window-name`. Body: `{object, method, args}`.
- In webview mode that endpoint is served **only inside the native webview's
  in-process URL-scheme handler** (`wails://`), wired as middleware on the asset
  server. There is **no TCP listener** for it — verified: the non-`server` build
  of `pkg/application` contains zero `net.Listen`/`http.Server`.
- `wails3 dev` runs Vite purely as a static asset server; the native app reaches
  it via a reverse proxy (`FRONTEND_DEVSERVER_URL`). Vite has no `/wails/runtime`
  route, so a browser POST there just 404s. Nothing bridges the browser to the Go
  process. This cannot be fixed with a Vite proxy (there's no TCP target) or a
  small shim (the `MessageProcessor` isn't exported) — only by forking Wails.

### What works: server mode (`-tags server`)

Wails v3 alpha (`v3.0.0-alpha.98-tui`) ships a supported headless server mode
behind the `server` build tag. It runs a real `http.Server` that:

- serves the built frontend (`frontend/dist`, or proxies Vite if
  `FRONTEND_DEVSERVER_URL` is set), and
- handles `/wails/runtime` over **plain HTTP fetch** — the same transport the
  runtime already uses. Binding calls round-trip from any browser.

Run it:

```sh
scripts/serve-browser.sh          # builds frontend + `go build -tags server`, serves :9500
SKIP_FRONTEND=1 scripts/serve-browser.sh 9500   # reuse an existing frontend/dist
```

Verified round-trip (this is exactly what a browser sends):

```sh
curl -s -X POST http://localhost:9500/wails/runtime \
  -H 'Content-Type: application/json' \
  -H 'x-wails-client-id: any-id' \
  -d '{"object":0,"method":0,"args":{"call-id":"x","methodID":3769940222,"args":[]}}'
# -> {"id":1,"memoryBudgetBytes":536870912,...}   (real GetAppSettings row)
```

`object:0 method:0` is a bound-method Call; `methodID` is the numeric ID from the
generated bindings in `frontend/bindings/**` (e.g. `$Call.ByID(3769940222)` =
`GetAppSettings`). Window-scoped calls without a live client still resolve because
call/events/application/system requests don't require a window.

Caveats:

- **Headless, not the native window.** It's the real Go backend + services (DB,
  MQTT, etc.), so bindings behave for real — but there's no OS window, menus,
  dialogs, screens, or native file pickers (those are no-ops in server mode).
- **Backend→frontend live events need one extra step.** Events are pushed over a
  WebSocket set up by `/wails/custom.js`, which server mode serves but does *not*
  auto-inject. If you need live pushes (incoming MQTT messages, etc.), add
  `<script src="/wails/custom.js"></script>` to the page. Plain request/response
  binding calls need nothing extra.
- Production is unaffected: `wails3 build`/`package` never pass `-tags server`, so
  the shipping app is always the native webview build.

### Field-tested walkthrough (Sparkplug e2e, 2026-07)

A full e2e drive of the app (create connection, connect to a local broker,
watch live traffic, click UI actions, verify a publish round trip) works in
server mode from an agent-driven browser. Lessons that save time:

- **Inject the events script after every page load** (it is not auto-injected
  and is lost on reload): append `<script src="/wails/custom.js"></script>`,
  then look for "[Wails] Event WebSocket connected" in the console. Without it
  the UI never sees mqttConnected/mqttMessages and looks frozen.
- **Prefer accessibility refs over screenshot coordinates** for clicks; several
  panels (dialogs, tab strip) swallow coordinate clicks that land fine via refs.
- **Bindings can be called directly from page JS** when the UI path is fiddly:
  `POST /wails/runtime` with header `x-wails-client-id` and body
  `{object:0,method:0,args:{"call-id":"x",methodID:<id>,args:[...]}}`. Method
  ids live in `frontend/bindings/**` (`$Call.ByID(<id>)`). `GetAllConnections`
  returns `{connections:{"<id>":{connectionDetails:{...}}}}` — the model is the
  nested `connectionDetails`. After `UpdateConnection` (e.g. flipping
  `isProtoEnabled`), disconnect + reconnect so per-connection middleware
  reinstalls.
- **Pass real ids**: methods like `DisconnectMqtt` panic the whole app on an
  unknown connection id (no not-found guard yet).
- Drive traffic with `scripts/mqtt-sim.py` (`--sparkplug` for births/aliases/
  seq faults; it answers NCMD rebirth requests) against a local mosquitto on
  1883, or `scripts/mqtt-flood.py` for load.

### Fallback for human/visual verification

For pixel-level UI checks, prefer **Storybook** on its own dev port (see
`scripts/dev-ports.sh` / `.claude/launch.json`) plus the **native app** via
`wails3 dev` for real end-to-end behaviour. Use server mode when an agent needs to
exercise real bindings over HTTP without a native webview.
## Writing style (binding, always)

Anything a user reads follows `docs/WRITING_STYLE.md`: the changelog and
"What's new" notes, dialog copy, tooltips, empty states, README, release
notes. Read that file before writing any of it. The hard rules, so they are
never missed:

- No em dashes, ever. It is the fastest tell that a machine wrote it.
- No emojis.
- First person singular ("I", not "we"), British spelling.
- Terse. Changelog section bodies are one sentence, dev-changelog style.
