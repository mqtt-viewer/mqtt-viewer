# Broker Status Window

## Goal

A detachable per-connection **Broker status** window giving an at-a-glance view of
broker health: curated stat tiles (connected clients, message/byte rates,
subscriptions, retained count, uptime, version) with session sparklines, fed by
`$SYS` metrics where the broker publishes them plus client-side observed rates that
work on **any** broker. Users can override or extend the metric mapping per
connection to fit their broker. Primary use case (GitHub discussion #1): portable
on-the-fly debugging; gauges primary, trends secondary.

## Non-goals

- No tab/toggle inside `MqttDataPanel` (deliberately independent of unmerged PR #76).
- No backend rate computation, Prometheus export, HTTP publishing.
- No long-term metric persistence — session-window data only.
- No multi-connection aggregate dashboard; one window per connection.

## Background (codebase facts)

- Every new connection is seeded with `#` **and** `$SYS/#` subscriptions
  (`backend/app/connections.go:63-72`). Users can delete the `$SYS/#` row.
  Subscriptions are applied on connection-up only (`backend/mqtt/subscribe.go`,
  wired in `connect.go`) — a sub added while connected takes effect after reconnect.
- Messages batch to the frontend every 300 ms via Wails event
  `server:mqtt-messages:<connId>` (`backend/app/startup.go:195-205`,
  `backend/mqtt/buffer.go`). Payloads arrive base64-encoded
  (`frontend/bindings/mqtt-viewer/backend/mqtt/models.ts`, `MqttMessage`).
- In-RAM history: `backend/mqtt/history.go` — `MessageHistory` keeps a global
  `recent` list (byte-budget evicted) plus `latest` newest-per-topic (survives
  eviction). `GetAllHistory()` (`history.go:116`) returns the full topic→messages
  map. Existing binding `GetMessageHistory(connId, topic)` is exact-topic only.
- Detached-window precedent: `backend/app/windows.go` — `OpenChartWindow`
  (focus-or-create keyed map, mutex, `WindowClosing` cleanup, URL
  `/?view=chart&conn=...`); frontend routing in `frontend/src/App.svelte:28-30`
  (`isChartWindow` renders only `ChartWindow.svelte`);
  `frontend/src/views/ChartWindow/ChartWindow.svelte` shows the standalone-window
  pattern (`connections.init()`, per-connection `eventSet`, `--wails-draggable`).
- DB: SQL migrations embedded from `backend/db/migrations/*.sql`, filename
  `YYYYMMDDHHMMSS_name.sql` (`backend/db/migrate.go`). GORM models in
  `backend/models/models.go`; `Subscription` (line 159) is the per-connection
  child-row template; CRUD template `backend/app/subscriptions.go`.
- Bindings: exported methods on `*app.App` auto-become frontend bindings; regen via
  Taskfile task `generate:bindings` (`wails3 generate bindings -clean=true -ts`),
  output `frontend/bindings/**`. Storybook mocks mirror at
  `frontend/.storybook/mocks/bindings/`.
- JSON-path payload extraction already exists and is tested:
  `valueAtPath(payload, path)` in
  `frontend/src/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/payload-fields.ts`
  (handles bare numbers, quoted numbers, EU decimal commas, dotted paths).
- Design system: every component ships `X.svelte` + `X.spec.json` +
  `X.stories.svelte` (+ optional `.test.ts`); validate with `pnpm ds:validate`;
  `component-index.json` is generated. Icons: semantic keys in
  `frontend/src/components/Icon/icons.ts` wrapping phosphor-svelte. Theme via
  Tailwind tokens (`bg-elevation-1`, `text-secondary-text`, `border-outline`,
  `text-emphasis`, `success`/`error`/`warning`).
- `Tabs.svelte` is hard-capped at 4 slots and SelectedTopicPanel already uses all 4
  in MQTT v5 mode — one reason the status page is a window, not a tab.

## Design

### Data flow

```
broker ──$SYS/# sub──► backend MessageHistory ──batch event──► broker-status-store
                                    │                              ▲
                                    └── GetSysMessageHistory ──────┘ (backfill at open)

all messages (any topic) ──batch event──► observed-rate ring buffer (msgs/s, bytes/s)
```

### Backend additions (all in `backend/app/`, plus one migration)

1. **`OpenBrokerStatusWindow(connectionId uint) error`** in `windows.go` — clone of
   `OpenChartWindow`: keyed `statusWindows` map (key = connId), focus-or-create,
   URL `/?view=status&conn=<id>`, title `<connection name> — broker status`
   (fetch name from DB; fall back to `Broker status`), size 760×560 min 520×380,
   same Mac titlebar/background options, `WindowClosing` cleanup with
   same-window guard.
2. **`GetSysMessageHistory(connId uint) ([]mqtt.MqttMessage, error)`** — resolve the
   connection's `MessageHistory`, call `GetAllHistory()`, return messages whose
   topic starts with `$SYS/`, flattened and sorted by `timeMs` ascending. Used for
   backfill so a window opened mid-session starts populated.
3. **Custom mappings model + CRUD** (`models.go`, new `sys_metric_mappings.go`):

   ```go
   type SysMetricMapping struct {
       ID           uint      `json:"id" gorm:"primaryKey"`
       CreatedAt    time.Time `json:"createdAt"`
       UpdatedAt    time.Time `json:"updatedAt"`
       ConnectionID uint      `json:"connectionId"`
       MetricKey    string    `json:"metricKey"`   // builtin tile id to override, or "" = custom tile
       Label        string    `json:"label"`       // display label (custom tiles)
       Topic        string    `json:"topic"`       // exact topic to read (any topic, not only $SYS)
       PayloadPath  string    `json:"payloadPath"` // optional dotted JSON path
       Unit         string    `json:"unit"`        // optional display suffix
       SortOrder    int       `json:"sortOrder"`
   }
   ```

   Bindings mirroring `subscriptions.go`:
   `GetSysMetricMappingsByConnectionId(connId)`, `AddSysMetricMapping(connId,
   mapping)` (unlike `AddSubscription`, takes the full row so "pin from raw
   browser" creates it in one call), `UpdateSysMetricMapping(connId, mapping)`,
   `DeleteSysMetricMapping(connId, id)`.
4. **Migration** `backend/db/migrations/<ts>_add-sys-metric-mappings.sql`: create
   table with FK to `connections(id)` ON DELETE CASCADE, matching existing
   migration style (inspect a recent child-table migration for exact idiom).
5. Regenerate bindings; update the Storybook binding mock with no-op/fixture
   implementations of the four new methods (`frontend/.storybook/mocks/bindings/...`).

### Frontend — window shell & routing

- `frontend/src/App.svelte`: add `isStatusWindow` (`view === "status"`) beside
  `isChartWindow`; render new `BrokerStatusWindow` view only.
- `frontend/src/views/BrokerStatusWindow/BrokerStatusWindow.svelte`: mirrors
  `ChartWindow.svelte` — parse `conn` from URL, `connections.init()`, error state if
  connection missing, create store on mount, `store.destroy()` on destroy,
  `IconContext` + `Toast`, draggable header. Header: connection name, connection
  state dot, gear button (mapping editor dialog), collapse control for raw browser.
- Disconnected state: listen to the connection's `connected`/`disconnected` events
  (`connection.eventSet`); when disconnected show a slim warning banner
  ("Disconnected — values frozen") and stop the observed-rate ticker; values remain.

### Frontend — store (`BrokerStatusWindow/broker-status-store.ts`)

- On create: `GetSysMessageHistory(connId)` backfill; for each custom mapping whose
  topic is *not* under `$SYS/` additionally `GetMessageHistory(connId, topic)`.
  Then `Events.On(eventSet.mqttMessages)` for live updates;
  `Events.On(eventSet.mqttClearHistory)` resets everything. `destroy()` unbinds.
- Keeps: `latestByTopic: Map<topic, {value: string (utf8-decoded), timeMs}>` for
  `$SYS/*` + mapped topics (raw browser reads this); per-metric sample ring buffer
  `{timeMs, value}[]` (cap ~300 samples) for sparklines.
- **Observed rates** (broker-independent): ring buffer of `{timeMs, count, bytes}`
  for *all* incoming messages in the batch handler; a 1 s ticker computes msgs/s
  and bytes/s over a sliding 60 s window and appends sparkline samples. Payload
  byte size from base64 length ×3/4 (close enough; note in code).
- **Cumulative-counter rates**: mappings flagged `kind: "cumulative"` derive a rate
  from successive samples: `(vₙ − vₙ₋₁) / Δt`, clamped ≥ 0 (counter resets on
  broker restart), rendered as `/s`.

### Performance (hard requirements)

The status window must not degrade the main window under heavy broker load:

- **Observed-rate counting is counters-only.** The all-messages feed increments
  per-second bucket counters (`count`, `bytes`) in a fixed-size ring (61 buckets)
  — never store per-message objects, never allocate per message. Per-batch cost:
  one loop of integer adds.
- **$SYS filtering is a cheap prefix check** (`topic.startsWith("$SYS/")` plus a
  `Set` lookup for custom mapping topics) done once per message in the batch
  handler; non-matching messages contribute only to the counters above.
- **Svelte store writes are coalesced**: at most one `set`/`update` per incoming
  batch event (300 ms cadence) and one per 1 s ticker tick — never per message.
  Sparkline sample buffers capped (~300 points) with in-place trimming.
- **Tree row cost unchanged**: the `$SYS` inline button prop is computed only for
  depth-0 rows; hover reveal is pure CSS (no JS listeners per row).
- **Main window unaffected when status window closed**: the store and its
  listeners exist only while the window lives (`destroy()` on close). Note Wails
  events broadcast to all windows regardless — the marginal cost of an open
  status window is the batch handler above.
- **Backend `GetSysMessageHistory`** iterates the history map once, copies only
  `$SYS/` messages; called once per window open.
- **Verification**: run the repo `/perf-check` flood harness with a status window
  open; frame rate / responsiveness must match the pre-change baseline within
  noise.

### Frontend — builtin metric registry (`BrokerStatusWindow/sys-metrics.ts`)

Pure, unit-testable module. Each builtin metric = id, label, unit, parser kind,
**ordered candidate topic patterns** (`+` wildcard allowed). First candidate with
data wins — no explicit broker-family detection needed. Per-connection override
rows (MetricKey set) replace a metric's candidates with the user's exact
topic/path.

| id | label | mosquitto-style (also NanoMQ, Mochi) | EMQX (`$SYS/brokers/+/…`) | kind |
|---|---|---|---|---|
| `clients_connected` | Connected clients | `$SYS/broker/clients/connected` | `stats/connections.count` | gauge |
| `msg_rate_in` | Msgs/s in | `$SYS/broker/load/messages/received/1min` | `metrics/messages.received` | gauge / cumulative |
| `msg_rate_out` | Msgs/s out | `$SYS/broker/load/messages/sent/1min` | `metrics/messages.sent` | gauge / cumulative |
| `bytes_rate_in` | Bytes/s in | `$SYS/broker/load/bytes/received/1min` | `metrics/bytes.received` | gauge / cumulative |
| `bytes_rate_out` | Bytes/s out | `$SYS/broker/load/bytes/sent/1min` | `metrics/bytes.sent` | gauge / cumulative |
| `subscriptions` | Subscriptions | `$SYS/broker/subscriptions/count` | `stats/subscriptions.count` | gauge |
| `retained` | Retained msgs | `$SYS/broker/retained messages/count` (space is real) | `stats/retained.count` | gauge |
| `uptime` | Uptime | `$SYS/broker/uptime` (`"N seconds"`) | `uptime` (human string) | duration/string |
| `version` | Broker | `$SYS/broker/version` | `version` + `sysdescr` | string |

Plus two **always-present client-side tiles** (no topic): `observed_msg_rate`
"Observed msgs/s" and `observed_byte_rate` "Observed bytes/s", computed by the
store; these carry a tooltip "measured by this client across its subscriptions".

VerneMQ publishes under `$SYS/<node>/…` with counter semantics that differ per
version — do **not** hardcode a guessed VerneMQ table. Implementer: check current
VerneMQ docs during implementation; if the scheme maps cleanly onto candidates,
add patterns + fixtures; if not, VerneMQ users are served by the raw browser +
custom mappings (that is the feature's escape hatch). Log the outcome in the
decisions log.

Parsers: `gauge` (numeric via `valueAtPath` with empty path), `cumulative`
(numeric, rate derived in store), `duration` (`"123 seconds"` → humanized
`2h 3m`), `string` passthrough. Non-parseable payload → tile shows raw string
(never NaN).

Per-mosquitto load semantics: `load/.../1min` values are **moving averages of
messages per minute**; divide by 60 and label `/s`.

### Frontend — UI components (each with spec.json + story)

- **`StatTile.svelte`** — label, big value (formatted: SI abbreviations for large
  numbers, 1 decimal max), optional unit, optional `Sparkline`, subdued
  "no data yet" state.
- **`Sparkline.svelte`** — pure SVG polyline, props `points: {t,v}[]`, fixed
  height ~28 px, stroke `currentColor` (parent sets a token color), no axes, no
  external lib. Renders nothing under 2 points.
- **`BrokerStatusView.svelte`** — the window body: responsive tile grid
  (`grid-cols-[repeat(auto-fill,minmax(170px,1fr))]`), custom-mapping tiles after
  builtins (by `SortOrder`), then an **"add tile" (+) tile** always rendered as
  the last grid cell: same footprint as `StatTile`, dashed `border-outline`
  border, centered plus icon, tooltip "Add metric tile"; click opens
  `MetricMappingEditor` in add mode (blank custom mapping). Saved rows persist
  via the `SysMetricMapping` CRUD and render immediately. Below the grid, the
  collapsible **raw $SYS browser**: table of
  `latestByTopic` sorted by topic (topic, latest value truncated, age), simple
  substring filter input, each row a "pin as tile" icon button that opens the
  mapping editor pre-filled with the topic and current value preview.
- **Mapping editor dialog** (`MetricMappingEditor.svelte`) — opened via gear or
  pin. Lists the connection's mappings; add/edit rows: Label (`BaseInput`), Topic
  (`BaseInput`), JSON path (optional `BaseInput`), Unit (optional), "Overrides"
  (`Select` over builtin metric ids, default "None — custom tile"), delete button.
  Persist via the CRUD bindings; store reloads mappings on change. Follow existing
  dialog conventions (see `LoadedProtoDetailsDialog` / `HistoryRetentionPrompt`
  for dialog chrome).
- **Empty state** — if no `$SYS` message ever seen and ≥10 s since window open
  (or since connect): explain the broker may not publish `$SYS`, or the `$SYS/#`
  subscription was removed. If the connection has no `$SYS/#` subscription row,
  show CTA "Add $SYS/# subscription" → `AddSubscription` + `UpdateSubscription`
  to set topic `$SYS/#`, then toast "Subscription added — reconnect to apply"
  (subs apply on connection-up only). Observed-rate tiles still render, and the
  "+" tile stays present in the empty state so users on unmapped brokers can
  build their own tile set from scratch (these persist like any custom mapping).

### Entry points (two)

1. Icon button in `SearchActionBar`
   (`frontend/src/views/Connection/DataView/components/MqttDataPanel/components/SearchActionBar/SearchActionBar.svelte`),
   after the existing action icons, tooltip "Broker status", calls
   `OpenBrokerStatusWindow(connectionId)`. New icon key `pulse` in
   `components/Icon/icons.ts` (phosphor `Pulse`).
2. **Inline on the `$SYS` tree row** (discoverability): in `MqttTopicRow.svelte`,
   when the row is the root-level `$SYS` node (all mapped broker families —
   mosquitto/EMQX/VerneMQ — root their status topics at `$SYS`), render a small
   `pulse` icon button right-aligned in the row, revealed on row hover (row is
   currently one big `<button>`; the inline action must `stopPropagation` so it
   doesn't toggle expansion — restructure to a nested clickable span or sibling
   absolute-positioned button, whichever keeps a11y sane). Tooltip "Broker
   status". Detection: thread a `onOpenBrokerStatus?: () => void` prop from
   `MqttTopicTree` (which knows depth) set only for depth-0 rows with
   `topicLevel === "$SYS"`; handler calls `OpenBrokerStatusWindow(connectionId)`.
   Custom non-`$SYS` status roots are not auto-detected — SearchActionBar button
   covers those.

## Implementation steps (each verifiable)

1. **Migration + model + CRUD bindings** — files: `backend/db/migrations/<ts>_add-sys-metric-mappings.sql`,
   `backend/models/models.go`, `backend/app/sys_metric_mappings.go` (+ test
   `sys_metric_mappings_test.go` following `connections_test.go` setup).
   Verify: `go test ./backend/...` (broker-dependent tests flake under parallel
   agent runs — re-run solo before believing a failure).
2. **`GetSysMessageHistory` + `OpenBrokerStatusWindow`** — `backend/app/mqtt.go`
   (or `history` neighbor) + `backend/app/windows.go` (+ URL-builder test in
   `windows_test.go`). Verify: go tests.
3. **Regenerate bindings** — task `generate:bindings`; update Storybook binding
   mock. Verify: `pnpm check` (svelte-check) still clean, storybook mock compiles.
4. **`sys-metrics.ts` registry + parsers** with unit tests: mosquitto + EMQX
   fixture payloads, candidate precedence, override merging, `1min`→/s division,
   duration humanizing, non-numeric fallback. Verify: `pnpm test` (vitest).
5. **`broker-status-store.ts`** with unit tests: backfill merge, live batch
   handling, observed-rate window math, cumulative-rate derivation +
   counter-reset clamp, clear-history reset. Verify: vitest.
6. **`Sparkline` + `StatTile`** components + spec.json + stories. Verify: stories
   render, `pnpm ds:validate`.
7. **`BrokerStatusView` + raw browser + empty state** + spec.json + story with
   mock data. Verify: story, ds:validate.
8. **`MetricMappingEditor`** + pin-from-raw-browser flow + spec.json + story.
   Verify: story, ds:validate.
9. **`BrokerStatusWindow` shell + App.svelte routing + both entry points**
   (SearchActionBar button, `$SYS` row inline button) + `pulse` icon. Verify:
   svelte-check clean; MqttTopicRow story updated if its spec/story exists.
10. **Live verification** (Testing section) + changelog entry via `/changelog`
    skill.

## Edge cases (decided)

- **Broker publishes no $SYS** → empty state after 10 s; observed-rate tiles still live.
- **`$SYS/#` sub deleted** → same empty state + add-subscription CTA + reconnect toast.
- **Retained $SYS values** (mosquitto retains most `$SYS`) → arrive immediately on
  connect; backfill handles window-opened-later.
- **Counter reset** (broker restart) → negative delta clamped to 0.
- **Non-numeric payload on numeric tile** → show raw string, no sparkline point.
- **Custom mapping topic outside `$SYS/`** → allowed; backfilled via exact-topic
  `GetMessageHistory`.
- **Window open while disconnected** → renders with banner; backfill still shows
  last session's in-RAM data if any.
- **Connection deleted while window open** → window shows "Connection not found"
  error state on next store action; acceptable (matches ChartWindow behavior).
- **Duplicate window** → focus-or-create keyed by connId.
- **History cleared** (`mqttClearHistory` event) → store resets tiles, sparklines,
  raw browser.
- **`retained messages/count`** — mosquitto topic genuinely contains a space; keep verbatim.

## Testing

- **Go**: mappings CRUD, `GetSysMessageHistory` filtering/ordering, status-window
  URL builder. Broker-dependent suites: run solo if flaky.
- **Vitest**: sys-metrics registry (fixtures per broker family), parsers, store
  rate math, override/custom merge.
- **Storybook**: stories for Sparkline, StatTile, BrokerStatusView,
  MetricMappingEditor; full story build passes; `pnpm ds:validate` green.
- **Manual (live)**: `just dev` + local mosquitto + traffic
  (`for i in $(seq 1 500); do mosquitto_pub -t "factory/line$((RANDOM % 3))/s$((RANDOM % 4))" -m "{\"v\": $RANDOM}"; sleep 0.2; done`).
  Check: window opens/focuses from SearchActionBar AND from the hover button on
  the `$SYS` tree row (and that clicking it does not toggle row expansion); tiles
  populate from retained
  $SYS immediately; msgs/s moves under load; observed vs $SYS rates roughly agree;
  sparklines draw; raw browser lists `$SYS/*`; pin-as-tile creates a working
  custom tile; "+" tile at grid end opens the editor and a saved tile appears and
  survives app restart; override redirects a builtin tile; disconnect shows banner
  and freezes; delete `$SYS/#` sub + reconnect shows empty state + CTA + "+" tile.
  If docker available: spin up EMQX (`docker run -p 1883:1883 emqx/emqx`) and
  verify EMQX candidates + cumulative-rate derivation live.

## Decisions log

- Detachable window (not a MqttDataPanel tab) — user choice; also avoids coupling
  to unmerged PR #76 and the 4-slot `Tabs.svelte` cap.
- Rates from $SYS **and** client-side observed — works on brokers without $SYS.
- Tiles + sparklines; SVG sparklines instead of ECharts (8+ tiny charts don't
  justify ECharts instances; keeps window light).
- Multi-broker candidate patterns (mosquitto-style + EMQX; VerneMQ investigated at
  implementation time, escape hatch = raw browser + custom mappings) — user OK'd
  extra work.
- Per-connection custom mappings in DB (`SysMetricMapping`), both override-builtin
  and custom-tile flavors; editor inside the status window incl. pin-from-raw-browser.
- "+" tile as permanent last grid cell (user request at Gate 2): opens editor in
  add mode; present in empty state too; custom tiles persist in DB per connection.
- Performance is a hard requirement (user request during build): counters-only
  rate tracking, coalesced store writes, CSS-only hover, /perf-check flood
  harness must match baseline with the window open.
- Implementation findings (sys-metrics.ts): VerneMQ family ADDED — topics
  verified from vmq_systree.erl/vmq_metrics.erl source ($SYS/<node>/… bare-number
  payloads; system_wallclock ms → uptime; no version metric, raw browser covers
  it). EMQX candidates include both 4.x dotted (`stats/connections.count`) and
  5.x slashed (`stats/connections/count`) spellings — the spec table's
  `metrics/messages.received` dotted-metrics form never existed; both spellings
  registered, first-with-data wins. EMQX 5 uptime = bare milliseconds (scale
  1/1000); EMQX 4 human-string uptime falls through to raw-text display.
- Entry points: SearchActionBar icon button (assumption accepted at Gate 1) plus
  hover-revealed inline button on the root `$SYS` tree row (user request at Gate 2)
  — inline button limited to `$SYS` root; custom status roots use the toolbar button.
- Spec committed at `docs/broker-status-spec.md` per repo convention (PR #76 precedent).
- Post-build review (8-angle + adversarial verify) confirmed 12 bugs; all fixed:
  backfill rejection on unpublished custom topics, cumulative-rate reseed on
  candidate-topic switch, observed-rate warm-up scaling, clear-history epoch
  guard, stable id-based custom tile keys, subscriptions-store init in the
  status window, tabs-wipe guard for detached windows (ConnectionDeleted),
  connection-state seeding routed through updateConnectionState, mapping CRUD
  ownership checks + created_at preservation, prefix-filtered history accessor,
  keyboard a11y on the tree pulse button, `#` wildcard support in
  topicMatchesPattern. Plus: Select empty-value root fix (replaced the editor's
  sentinel), StatTile kind prop (replaced string-length heuristic), no em
  dashes in user-facing copy (docs/WRITING_STYLE.md hard rule), windows.go
  focus-or-create dedup.
- Verified live end to end via Wails server mode (`scripts/serve-browser.sh`,
  see AGENTS.md): connect to local mosquitto (docker), backfill, live tiles
  under a ~2k-message flood, custom tile add + persistence across app restart,
  editor CRUD, raw browser, both entry points, empty/disconnected states.
  Native-window E2E (OpenBrokerStatusWindow focus-or-create, window chrome) and
  the official 2-broker native flood run were NOT exercised (no human at the
  native app); store-level flood benchmark shows ~70x headroom vs the 5 ms/batch
  bar (broker-status-store.perf.test.ts).
