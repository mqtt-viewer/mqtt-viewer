# Topic charting (issue #43) — build spec

Branch: `feat/issue-43` → PR into `develop`.
Mocks: [Payload picker](https://www.figma.com/design/f1tvIf8T35FTls7kM6QJUs/MQTT-Viewer?node-id=6472-24) · [Chart tab](https://www.figma.com/design/f1tvIf8T35FTls7kM6QJUs/MQTT-Viewer?node-id=6471-24)

## Goal

Chart numeric values from the **currently selected topic** over time — pick
fields from a JSON payload (nested ok), or chart a raw numeric payload. Plot
**historical** messages already in the store **and live-append** as new ones
arrive, with **pause**. Single topic per chart. Ships with **pop-out into its
own Wails v3 window** so a chart can live alongside the main app.

## Decisions (locked with maintainer)

- Single topic, in the existing selected-topic right panel, **with pop-out
  into a separate Wails v3 window** (in scope, not deferred). No multi-card
  dashboard — that need is met by opening several pop-out windows.
- Chart library: **ECharts** (canvas; handles large historical windows + live
  append + zoom/pan well). LayerChart was the noted alternative; ECharts wins
  on big/live datasets and bundle size is a non-constraint.
- Historical + live, with pause. X-axis = arrival time (v1).
- No squiggle glyph in the picker (just the checkbox).

## Where it lives & the key implementation reality

The Payload tab renders payloads in **CodeMirror** (syntax-highlighted text),
so checkboxes can't be injected inline. andyg2's wording fits: a button that
*converts* the payload to a tree. So:

- **Payload tab** gets a small **"Chart fields"** toggle. Off = today's
  CodeMirror. On = a **DOM JSON-tree picker** (new component) rendering the
  latest message: every numeric leaf (incl. nested) gets a checkbox + assigned
  colour; strings/objects/arrays are shown but not tickable. Raw numeric
  payload = a single tickable row. Footer: "N values selected · View chart →".
- **Chart tab** (new 4th tab) renders the ECharts line chart of all visible
  series + a **SERIES legend** (colour swatch · field name · full path · eye
  toggle · ✕ remove) + "+ Add value from payload" (jumps to the picker).

## Components / files

```
SelectedTopicPanel.svelte          add "Chart" tab; pass chart store
└─ Chart/ (new, shared by in-panel tab AND the pop-out window)
   ├─ chart-series-store.ts         per-topic series state + value extraction
   ├─ payload-fields.ts             flatten payload JSON → numeric leaf paths
   ├─ FieldPicker.svelte            DOM JSON tree w/ numeric checkboxes
   ├─ TopicChart.svelte             ECharts line chart (historical + live)
   ├─ SeriesLegend.svelte           swatch/name/path/eye/remove rows
   ├─ ChartOptions.svelte           gear popover (x-axis, window, style, points)
   └─ ChartWindow.svelte            standalone shell for the pop-out window
PayloadTab.svelte                   add "Chart fields" toggle → FieldPicker
App.svelte (root)                   route detection: render ChartWindow when
                                     the window URL is the chart route
backend/app/windows.go (new)        OpenChartWindow / focus-or-create
```

### Data model

- `payload-fields.ts`: `numericFields(payloadJson) -> { path: string; value: number }[]`.
  Flattens nested objects with dotted paths (`sensor.rssi`); arrays indexed
  (`vals.0`). A bare number payload → `[{ path: "", value }]`.
- `chart-series-store.ts` (per selected topic): `series: { path, color, visible }[]`.
  Colours from a fixed palette (amber, primary, green, …). Adding/removing a
  field toggles a series. Cleared on topic deselect/change.
- Series points are derived from the selected-topic store's `history`
  (already in the frontend): for each message, parse payload JSON once, read
  `path`, emit `(timeMs, value)` when numeric. Live messages append the same way.

### TopicChart.svelte (ECharts)

- One `line` series per visible chart-series; `xAxis: time`, `yAxis: value`.
- Historical: seed from `history` on mount/topic-change (reuse the same
  rebuild-on-window pattern as MessageTimeline).
- Live: on new messages for the topic, `appendData`/merge new points unless
  paused.
- **Pause**: toggle; while paused, buffer incoming points (or just stop
  appending) and freeze auto-scroll; on resume, flush.
- Built so the chart + series store could be handed to a separate Wails window
  later (no hard dependency on the panel's DOM).

### ChartOptions (gear) — keep minimal for v1

- X axis: **Arrival time** (default). (Pick-a-datetime/numeric-field-as-X is a
  fast follow, not v1.)
- Time window: All / Last N min.
- Style: Line / Area. Show points: on/off.

## Multi-window pop-out (in scope)

A chart can be detached into its **own Wails v3 window** that lives and
live-updates independently of the main window. This works because all windows
share one Go backend and events are app-global (`Events.Emit` reaches every
window), so a detached chart subscribes to the same `mqttMessages:<connId>`
stream.

**Backend** (`backend/app/windows.go`, a new App-service method):

```go
type OpenChartWindowParams struct {
    ConnectionID uint     `json:"connectionId"`
    Topic        string   `json:"topic"`
    Fields       []string `json:"fields"` // selected numeric paths
}
func (a *App) OpenChartWindow(p OpenChartWindowParams) error
```

- Builds a window URL carrying the state, e.g.
  `"/?view=chart&conn=<id>&topic=<enc>&fields=<enc-json>"`, and calls
  `application.Get().Window.NewWithOptions(application.WebviewWindowOptions{
  Title: topic + " — chart", Width: 900, Height: 520, URL: url, ...})`
  (same options idiom as `main.go`).
- **Focus-or-create**: keep a `map[key]*WebviewWindow` keyed by
  `connId+"|"+topic`; if a chart window for that pair is open, `.Focus()` it
  instead of opening a duplicate. Clean the map on the window's close event.
- `ApplicationShouldTerminateAfterLastWindowClosed` already handles lifecycle
  (app quits only when the last window — main or chart — closes).

**Frontend routing** (`App.svelte` root):

- On load, read `window.location` query. If `view=chart`, render
  **`ChartWindow.svelte`** (a bare shell: title bar + `TopicChart` +
  `SeriesLegend` + `ChartOptions`, no app sidebar/tabs) instead of the main
  app. Otherwise render the app as today.
- `ChartWindow` reads `conn`, `topic`, `fields` from the URL, seeds the
  chart-series store, fetches historical via `GetMessageHistory` (same binding
  the panel uses), looks up the connection's event set
  (`GetAllConnections`/existing binding), and subscribes to `mqttMessages` for
  live append — identical data path to the in-panel chart, just a different
  shell.

**UX / handoff**

- A **pop-out ⤢** button in the Chart tab calls `OpenChartWindow` with the
  current topic + selected fields.
- Once popped out, the in-panel Chart tab shows a compact "Charting in a
  separate window" state with **Focus window** and **Bring back** actions
  (re-dock = close the window, resume in-panel). Both surfaces live-update
  fine, so showing both is also acceptable; the placeholder keeps it tidy.
- Closing the chart window (or "Bring back") re-docks: the panel resumes the
  in-tab chart with the same series.

**Shared code:** `TopicChart`, `SeriesLegend`, `ChartOptions`,
`chart-series-store`, `payload-fields` are reused verbatim between the in-panel
tab and `ChartWindow`; only the surrounding shell differs.

## Backend (data)

No new data backend — the chart reads the topic's history from the existing
frontend store (`GetMessageHistory` + live event stream). The only new backend
is `OpenChartWindow` (window management, above). When the bounded/durable-
history work (PR #74) lands on develop, the windowed history feeds deeper
back-scroll for free.

## Out of scope (v1)

- Multi-topic dashboard / card grid (open several pop-out windows instead).
- Datetime/field-based X-axis (fast follow).
- Persisting open chart windows across app restart.

## Verify

- Numeric extraction unit tests (nested, arrays, raw number, non-JSON).
- Chart renders historical, live-appends, pauses/resumes.
- Pop-out: opens a second window rendering the standalone chart, live-updates
  from the same stream, focus-or-create dedupes, re-dock works. Verify on a
  live `wails3` boot (multi-window needs the real runtime, not Storybook).
- Design-system: spec.json + stories per new component (ChartWindow story uses
  a mocked series store); `pnpm check`, `ds:validate`, `pnpm build`, stories
  green.
