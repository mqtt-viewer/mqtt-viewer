# Chart time-window options and custom interval

## Goal

The topic chart's "Time window" selector currently offers only All history,
5 min, 15 min and 60 min. Add the longer presets requested in issue #106
(3h, 6h, 12h, 1 day) plus a custom interval (a number and a unit including
seconds), and make the chosen window persist per connection across app
restarts. The window is a pure view filter over whatever message history is
currently held; it does not change retention.

Supporting seconds means the integer-minutes contract used today cannot hold a
sub-minute window, so the canonical unit becomes **seconds** (`int64`)
end-to-end: the `windowMinutes` prop is renamed to `windowSeconds`, and
`TopicChart` multiplies by 1000 instead of 60000.

## Non-goals

- Persisting `style` or `showPoints` (they stay ephemeral component state).
- Per-topic windows. Scope is per connection: every topic charted under a
  connection shares that connection's window.
- Live cross-window sync. Changing the window in the docked chart does not
  push into an already-open pop-out window; each surface reads the persisted
  value on mount and writes on change. Reopening a surface picks up the latest.
- Any change to history retention or the memory budget. If the selected window
  is longer than the data actually retained, the chart simply shows all it has.

## Background

Key files:

- `frontend/.../Chart/ChartOptions.svelte` — the settings dropdown. Holds the
  `windowOptions` preset list and binds the window value (renamed to
  `windowSeconds`; `0` = All history).
- `frontend/.../Chart/ChartView.svelte` — docked chart host. Owns local
  `windowSeconds`, `style`, `showPoints`; renders `ChartOptions` and
  `TopicChart`. Receives `selectedTopicStore` (which carries `connectionId`).
- `frontend/.../Chart/TopicChart.svelte` — consumes the window value; when
  `> 0` it drives the sliding x-axis. Currently `min = now - windowMinutes*60000`;
  becomes `min = now - windowSeconds*1000`. Also update the reactive statement
  and any `windowMinutes` references in this file (grep confirms it appears on
  the pause/tick sync path too).
- `frontend/src/views/ChartWindow/ChartWindow.svelte` — the pop-out window, a
  separate frontend instance. Reads `conn`/`topic`/`fields` from the URL and
  renders the same `ChartView`. Knows `connectionId` directly.
- `frontend/.../SelectedTopicPanel/SelectedTopicPanel.svelte` — renders the
  docked `ChartView` (two call sites); both already pass `selectedTopicStore`.

Persistence idiom to copy (keyed UI-state tables):

- `backend/models/models.go` — `SortState { ID string; ... }` and
  `PanelSize { ID string; ... }` are single-key upsert tables.
- `backend/app/sort.go` — `UpdateSortState(id, ...)` upsert via `Db.Save`;
  `GetSortStates() []SortState` loads all rows.
- `frontend/src/views/.../stores/sort.ts` + `frontend/src/stores/default-sorts.ts`
  — a store loads all rows once and writes through to the binding on change,
  keyed by a string (e.g. `"mqtt-data-sort"`).
- `loader/main.go` — every model is registered here for Atlas schema loading.

Migrations are SQL-first via Atlas: edit the GORM model, register in
`loader/main.go`, then `just new-migration <name>`. Never hand-edit applied
migrations.

`ChartOptions` is a design-system component: it has a colocated
`ChartOptions.spec.json` and `ChartOptions.stories.svelte`, and CI enforces
`pnpm ds:validate` + `pnpm test-storybook`. `BaseNumberInput` and `Select`
already exist in `frontend/src/components/InputFields/` for the custom field.

## Design

### Data model (per-connection persistence)

New keyed table mirroring `SortState`:

```go
// ChartWindow persists the chart time-window selection per connection. ID is
// the connection id (string). WindowSeconds is the selected window in seconds;
// 0 means "All history". A custom interval is stored as its resolved seconds.
type ChartWindow struct {
    ID            string `json:"id" gorm:"primaryKey"`
    WindowSeconds int64  `json:"windowSeconds"`
}
```

Register `&models.ChartWindow{}` in `loader/main.go`. Generate the migration
with `just new-migration chart_window`.

Only the resolved integer seconds is stored — enough to restore both the
preset highlight and the custom field (see reverse-mapping below). No FK to
`Connection`; like `SortState`/`PanelSize`, an orphaned row after a connection
delete is harmless and rare.

### Backend service — `backend/app/chart_window.go`

```go
func (a *App) UpdateChartWindow(connId string, seconds int64) error {
    return a.Db.Save(&models.ChartWindow{ID: connId, WindowSeconds: seconds}).Error
}

func (a *App) GetChartWindows() ([]models.ChartWindow, error) {
    var rows []models.ChartWindow
    if res := a.Db.Find(&rows); res.Error != nil {
        return nil, res.Error
    }
    return rows, nil
}
```

Regenerate bindings: `wails3 task common:generate:bindings`.

### Frontend store — `frontend/src/stores/chart-windows.ts`

Mirrors `default-sorts.ts` but with one critical difference: it must be
loadable on demand, because the pop-out window never runs
`initialization.init()` (`App.svelte` renders `<ChartWindow/>` directly for
`?view=chart` and skips the init branch entirely). So the store exposes:

- `init()` — idempotent: fetch all rows via `GetChartWindows` exactly once,
  cache in memory keyed by `String(connectionId)`; concurrent/repeat calls
  await the same in-flight promise. Safe to also register in
  `initialization.init()` for the docked path, but correctness must not depend
  on that — every consumer awaits `init()` itself.
- `get(connectionId)` — synchronous, returns cached seconds (default `0`).
  Only valid after `init()` has resolved.
- `set(connectionId, seconds)` — update cache and write through to
  `UpdateChartWindow`. Called only from a genuine user action (see wiring).

### `ChartOptions.svelte` — presets + custom field

Preset list (values in seconds) becomes:

```
All history (0), 5 min (300), 15 min (900), 60 min (3600),
3 hours (10800), 6 hours (21600), 12 hours (43200), 1 day (86400)
```

Below the presets, a "Custom" row: a `BaseNumberInput` for the value and a unit
selector (`seconds` ×1, `minutes` ×60, `hours` ×3600, `days` ×86400). Changing
either recomputes `windowSeconds = value * unitFactor` and applies it. The
custom row is shown as selected when `windowSeconds` matches no preset.

**Do not reuse the melt-ui `Select` component for the unit.** `Select` is a
second melt floating widget that portals its option list to `<body>`; nesting
it inside the melt `DropdownMenu` risks dismissing the menu on option click and
intercepting keystrokes, and its `defaultValue`/`selected` is read once at
mount so an async-seeded unit would not display. Instead render the four units
as inline buttons using the same `DropdownMenuItem` primitive the presets use
(proven to coexist with this menu) — e.g. a small horizontal row of unit
toggles, `isSelected` on the active unit.

`BaseNumberInput` does **not** validate or emit a number — it forwards `min`
as a plain HTML attribute and its `onChange` emits `string | undefined` from
the raw input value. So `ChartOptions` must parse and validate: `parseInt`,
reject empty/`NaN`/`< 1`, and keep the last valid value on bad input. Never
feed an unvalidated value into `windowSeconds`.

Reverse-mapping when seeding the custom field from a persisted non-preset
value `s`: if `s % 86400 == 0` → `{value: s/86400, unit: days}`; else if
`s % 3600 == 0` → `{value: s/3600, unit: hours}`; else if `s % 60 == 0` →
`{value: s/60, unit: minutes}`; else `{value: s, unit: seconds}`.

The custom `BaseNumberInput`/`Select` live inside a `DropdownMenu`; typing and
selecting must not dismiss the menu. Verify in the running app; if the menu
closes on interaction, stop propagation on the custom row (or the menu's
outside-click/keydown handling) rather than restructuring the menu.

### Wiring persistence — in `ChartView` only

All persistence lives in `ChartView.svelte`, which is the shared host: the
pop-out `ChartWindow.svelte` renders `<ChartView/>` and does not own the window
state, and `ChartView` only renders once `selectedTopicStore` is non-null in
both surfaces — so `connectionId` is available synchronously via
`get(selectedTopicStore).connectionId`. **Do not** add wiring to
`ChartWindow.svelte`, and do not split docked-vs-pop-out connectionId sourcing.

The seed/write ordering must avoid two failure modes proven possible here:
clobbering a saved value with the default `0` on mount, and a reactive write
loop. Specify it precisely:

1. `ChartView` starts with `let ready = false` and does **not** render the
   chart subtree (`ChartOptions` + `TopicChart`) until `ready` is true. This
   guarantees `ChartOptions`/its custom field mount with the correct seeded
   value, not a default `0` that seeds asynchronously afterward.
2. `onMount`: `await chartWindows.init()`, then
   `windowSeconds = chartWindows.get(connectionId)`, then `ready = true`.
3. Writes happen **only** through the change callback from `ChartOptions` (the
   user picked a preset or edited the custom field) → `chartWindows.set(
   connectionId, windowSeconds)`. There is **no** reactive statement mirroring
   `windowSeconds` into `set` — that is what would write `0` at init and loop.

`windowSeconds` remains the only value passed into `TopicChart` — no rendering
change beyond the ms conversion.

## Implementation

1. **Model + registration.** Add `ChartWindow` to
   `backend/models/models.go`; register `&models.ChartWindow{}` in
   `loader/main.go`. Verify: `go build ./...`.
2. **Migration.** `just new-migration chart_window`; confirm the generated SQL
   creates the `chart_windows` table. Verify: `just test` migration test passes,
   `go build ./...`.
3. **Backend service.** Add `backend/app/chart_window.go` with
   `UpdateChartWindow` + `GetChartWindows`. Add a focused test under
   `backend/app/` using `getTestApp(t)` (upsert then read back). Verify:
   `just test`, `go vet ./...`.
4. **Bindings.** `wails3 task common:generate:bindings`; confirm
   `UpdateChartWindow`/`GetChartWindows` appear in
   `frontend/bindings/mqtt-viewer/backend/app/app.ts`. Do not hand-edit.
5. **Frontend store.** Add `frontend/src/stores/chart-windows.ts` with the
   idempotent `init()` + synchronous `get` + write-through `set` described in
   Design. Optionally register `chartWindows.init()` in
   `stores/initialization.ts` for the docked path (correctness must not depend
   on it). Verify: `pnpm check`.
6. **Rename prop → `windowSeconds`.** Rename across `ChartOptions.svelte`,
   `ChartView.svelte`, `TopicChart.svelte` (incl. the `*1000` ms conversion at
   the x-axis line and the three other refs on the tick/pause-sync path — grep
   every `windowMinutes` in the file), the colocated
   `ChartOptions.spec.json` / `TopicChart.spec.json` (and while renaming,
   correct the prop `"type"` from `"string"` to `"number"`, default `0`), the
   `*.stories.svelte` prop lists, and the `windowMinutes` fixtures in
   `frontend/src/stories/fixtures.ts` (used by both `ChartOptions` and
   `TopicChart` stories). `ChartWindow.svelte` passes no window prop, so it
   needs no rename. Verify: `pnpm check`.
7. **ChartOptions UI.** Add the four presets and the custom
   `BaseNumberInput` + inline unit-button row (seconds/minutes/hours/days) with
   parse/validate as in Design. Update `ChartOptions.spec.json` and
   `ChartOptions.stories.svelte` to cover the new states. Regenerate the
   design-system registry: `pnpm ds:registry` (updates
   `src/design-system/component-index.json`, which currently still lists
   `windowMinutes`). Verify: `pnpm check`, `pnpm ds:validate`,
   `pnpm test-storybook`.
8. **Persistence wiring.** In `ChartView.svelte` only: `ready` gate +
   `onMount` `await chartWindows.init()` → seed → `ready = true`, and the
   `ChartOptions` change callback → `chartWindows.set(...)`. No wiring in
   `ChartWindow.svelte`. Verify: `pnpm check`, `pnpm build`.
9. **End-to-end.** Run the app (`just dev`), chart a topic, exercise presets +
   custom (incl. a sub-minute seconds value), confirm the menu stays open
   during custom entry, confirm the window survives an app restart, is
   independent between two connections, and that opening the pop-out then
   changing the docked window does not wipe the saved value.

## Edge cases

- **Custom value 0 or empty** → treat as invalid; clamp `BaseNumberInput` min
  to 1. `0` is reachable only via the "All history" preset.
- **Persisted value matches a preset** → highlight that preset, leave the
  custom field at its default (do not also mark custom selected).
- **Persisted value is non-preset** (e.g. 7200 = 2 hours) → mark custom
  selected and seed the field via reverse-mapping.
- **Sub-minute custom** (e.g. 30 seconds) → stored as 30; reverse-maps to
  `{30, seconds}`; `TopicChart` window = 30000 ms.
- **No row for a connection yet** → `get` returns `0` (All history).
- **Window longer than retained data** → chart shows all held messages; no
  error, no special messaging.
- **Docked and pop-out open at once** → each persists on its own change; the
  last writer wins in the DB, and neither live-updates the other (non-goal).
- **Very large custom value** (e.g. 999 days) → accepted; sliding window just
  spans more than any data, equivalent to All history in practice.

## Testing

- **Backend unit** (`backend/app/`, `getTestApp(t)`): `UpdateChartWindow`
  inserts then updates the same id; `GetChartWindows` returns all rows;
  distinct connection ids stay independent.
- **Migration** (`just test`): schema test covers the new table.
- **Frontend** (`pnpm check`, `pnpm test:run`): store `get`/`set` behaviour if
  a unit-testable seam exists; otherwise rely on `pnpm check` + Storybook.
- **Design system** (`pnpm ds:validate`, `pnpm test-storybook`): `ChartOptions`
  story renders presets and the custom row.
- **Manual** (`just dev`): preset selection filters the chart; custom
  number+unit applies (incl. seconds); dropdown stays open during custom entry
  and digit keys reach the number input; window persists across restart; two
  connections hold independent windows; pop-out inherits the connection's
  persisted window on open; **opening the pop-out does not overwrite the saved
  window with `0`, and neither does simply mounting a chart** (the clobber
  regression the review flagged — worth an explicit check).

## Decisions log

- **Per-connection scope, keyed-table storage** — user chose per connection
  over global/per-topic. Uses the existing `SortState`/`PanelSize` keyed-upsert
  idiom rather than a column on `Connection` or `AppSettings`.
- **Canonical unit = seconds (`windowSeconds`)** — adding a seconds unit broke
  the integer-minutes contract; rather than allow fractional minutes, the prop
  and stored value are seconds end-to-end (`TopicChart` multiplies by 1000).
- **Store resolved seconds only** — a single integer is the contract to
  `TopicChart`; a value+unit pair would add schema surface for no gain, and the
  custom field reconstructs cleanly by reverse-mapping.
- **Presets = existing four + 3h/6h/12h/1d** — exactly the issue's request.
- **Custom units = seconds/minutes/hours/days** — seconds added per the user's
  "just in case"; days included despite the memory budget rarely retaining a
  full day (harmless, and the user asked for day-scale).
- **Cross-window live sync is out of scope** — each surface reads on mount,
  writes on change; simplest correct behaviour without an event channel.
- **Persistence lives in `ChartView` only, behind a `ready` gate, written only
  on user action** (adversarial review) — the pop-out never runs
  `initialization.init()`, so the store is loaded on demand via idempotent
  `init()`; seeding before render and writing only from the `ChartOptions`
  change callback prevents the default `0` clobbering a saved value and avoids
  a reactive write loop.
- **Unit picker uses `DropdownMenuItem` buttons, not the melt `Select`**
  (adversarial review) — nesting a second melt floating widget inside the menu
  risks dismissal/keystroke interception and one-shot async seeding.
- **`ChartOptions` parses/validates the number itself** (adversarial review) —
  `BaseNumberInput` neither clamps nor emits a number.
- **Unit toggles are plain buttons, not `DropdownMenuItem`** (post-build
  review) — `DropdownMenuItem` uses melt `$item`, which dismisses the menu on
  click; the spec's mitigation was insufficient. Plain buttons with
  `stopPropagation` keep the custom row interactive.
- **`ChartView` seeds inside try/catch** (post-build review) — a rejected
  `chartWindows.init()` must not leave `ready` false and blank the chart; it
  falls back to All history and renders.
- **Storybook bindings mock updated** (post-build review) — the mock at
  `frontend/.storybook/mocks/bindings/.../app/app.ts` must export
  `GetChartWindows`/`UpdateChartWindow`, else every story importing the new
  store fails to load.
