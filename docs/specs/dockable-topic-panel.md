# Dockable selected-topic panel

The selected-topic panel is fixed to the right side of the data view. Wide
payloads and charts are cramped there, and on smaller windows the topic tree
gets squeezed. This spec makes the panel dockable, in the style of Chrome
DevTools: dock right (current behaviour, default), dock bottom, or pop out
into a separate window.

## Goals

- A dock-side control in the panel header menu with three options: dock
  right, dock bottom, open in separate window. The active option is
  highlighted.
- The left sidebar (publish panel) stays full height regardless of where the
  topic panel is docked.
- Dock choice persists across restarts. Right-dock width and bottom-dock
  height persist independently.
- The popped-out window follows topic selection in the main window, like
  DevTools follows the page.
- No regression to the performance bar (2 brokers at ~2000 msg/s).

## Non-goals

- No per-connection dock preference. The dock mode is one global setting.
- No change to how the panel opens (selecting a topic) or closes
  (deselecting).
- No changes to the chart pop-out window, which stays as it is.

## Dock modes

`mode: "right" | "bottom" | "window"`, default `"right"`.

Dock state persists in the `AppSettings` singleton (SQLite), not
localStorage. localStorage would be the weakest store across the three
webviews, and, decisively, the pop-out is a separate webview window:
localStorage writes do not propagate live between windows, so re-docking
from the pop-out's menu would never reach the main window.

- Add two columns to `models.AppSettings`: `TopicPanelDockMode string`
  (`"right" | "bottom" | "window"`, default `"right"`) and
  `TopicPanelLastDockedSide string` (`"right" | "bottom"`, default
  `"right"`, where to return when the pop-out closes). Migrate via
  `just new-migration <name>` per repo convention; never hand-edit applied
  migrations.
- Add a backend method `SetTopicPanelDock(mode, lastDockedSide string)` that
  validates, upserts the singleton row, and emits a global event
  `TopicPanelDockChanged` carrying both values.
- The frontend store `frontend/src/stores/topic-panel-dock.ts` initialises
  from `GetAppSettings`, exposes `setMode(...)` which calls
  `SetTopicPanelDock`, and subscribes to `TopicPanelDockChanged` so every
  window (main and pop-outs) converges on the same state. All dock changes,
  including re-dock from the pop-out menu and revert-on-close, flow through
  the backend event, never through window-local state alone.

## Layout

`DataView.svelte` restructures to:

```
flex row (full height)
├─ ResizableContainer (sidebar, resizeEdge right)   <- always full height
├─ flex col, grow, min-w-0
│  ├─ MqttDataPanel (grow, min-h-0)
│  └─ ResizableContainer (topic panel, resizeEdge top)   <- mode "bottom"
└─ ResizableContainer (topic panel, resizeEdge left)     <- mode "right"
```

- Mode `right`: unchanged from today. Panel id `selected-topic-panel`,
  min 275px, max 1/3 or 1/2 of window width as today.
- Mode `bottom`: panel renders under MqttDataPanel only; the sidebar column
  is untouched. New panel id `selected-topic-panel-bottom` so its height
  persists separately through the existing `PanelSize` upsert (string id
  primary key, no migration needed). Min height 220px, max 2/3 of the window
  height.
- Mode `window`: no docked panel renders in the main window at all.
- `dataViewWidth` maths: subtract the topic panel width only when mode is
  `right` and the panel is open. The sidebar `maxSize` ternary keys off
  "open and docked right" for the same reason.
- Only one instance of SelectedTopicPanel may be mounted at a time. Use a
  single `{#if}` chain keyed on mode, not two conditionally hidden copies,
  so per-topic stores and event listeners are not duplicated.

## ResizableContainer

Extend `resizeEdge` to accept `"top"`. When `"top"`:

- The container sizes its height instead of width (`style:height`,
  `transition-[height]`).
- The drag handle and hover indicator sit along the top edge, full width,
  `cursor-row-resize` (with the min/max cursor variants mirrored to
  `n-resize`/`s-resize`).
- Mouse maths use `movementY` (and `clientY` on the Linux path), where
  dragging up grows the panel.
- Existing horizontal behaviour and persistence are untouched. `bind:width`
  keeps working for horizontal; expose `bind:height` (or reuse `size`) for
  vertical so DataView can read it if needed.

`panelSizes` currently tracks `rootWindowWidth`. Add `rootWindowHeight` in
the same place it is measured (follow the existing pattern) so the bottom
dock can clamp to 2/3 of window height reactively.

Update `ResizableContainer.spec.json` and its story: add the new
`resizeEdge` option and a vertical example.

## Dock-side control

In the SelectedTopicPanel header's existing options menu, add a "Dock side"
row at the top: three icon buttons in a row (dock right, dock bottom, open
in window), the active one visually selected, matching how Chrome DevTools
presents dock side in its menu. Reuse `IconButton` and add the needed
Phosphor icons to `ICON_MAP` in `icons.ts` (suggested:
`SquareSplitHorizontal` for right, `SquareSplitVertical` for bottom,
`ArrowSquareOut` for window; pick the closest available Phosphor glyphs).
Tooltips on each: "Dock right", "Dock bottom", "Open in window".

Selecting a docked side sets the mode and `lastDockedSide`; the panel moves
immediately with its own persisted size. Selecting "open in window" pops the
panel out (below).

## Pop-out window

Backend, in `backend/app/windows.go`, following `OpenChartWindow`:

- `OpenTopicWindow(params { connectionId, topic })`, keyed by connection id
  in its own map, open-or-reuse with the same TOCTOU locking and
  `WindowClosing` cleanup. URL `/?view=topic&conn=<id>&topic=<encoded>`; the
  topic seeds a freshly created window's first render, because an event
  emitted before its JS runtime mounts would be dropped. When the window
  already exists the call is a no-op: it deliberately does not focus, since
  it runs on every topic selection and focusing would yank the user away
  from the tree they are clicking in. Suggested size 700x600, min 400x400,
  same background and Mac titlebar options.
- On `WindowClosing`, in addition to map cleanup, emit a global event so the
  main window can revert dock mode (below).

Events, following the `events` package pattern in `events/global.go` and the
frontend event-runtime wrapper:

- `TopicWindowSelect`: emitted by the main window when the mode is `window`
  and the selected topic changes (including deselect, with an empty topic).
  Payload: connection id and topic.
- `TopicWindowClosed`: emitted by the backend `WindowClosing` handler.
  Payload: connection id.

Frontend, new view `frontend/src/views/TopicWindow/TopicWindow.svelte`
modelled on `ChartWindow.svelte`:

- Parses `conn` from the URL, creates its own `selectedTopicStore`, renders
  SelectedTopicPanel full-window with the same props DataView passes
  (delete retained, export, open chart window all work from the pop-out).
- Listens for `TopicWindowSelect` for its connection and calls
  `selectTopic`/`deselectTopic` accordingly. Shows a simple
  "No topic selected" empty state (secondary text, centred) when nothing is
  selected.
- Cleans up its store and event listeners in `onDestroy`.
- Register the `view=topic` route wherever `view=chart` is dispatched.

Main-window behaviour when mode is `window`:

- Selecting a topic calls `OpenTopicWindow` (open-or-reuse, no focus) and
  emits `TopicWindowSelect`. Opening the window on first switch to "open in
  window" uses the currently selected topic.
- Only the active tab drives the pop-out. Background tabs keep their
  DataView mounted behind `display: none`, so without this guard a global
  switch to window mode would spawn a pop-out for every tab with a
  selection. Switching to a tab while in window mode opens or updates that
  connection's pop-out with its current selection.
- When the pop-out window closes and the mode is still `window`, the
  backend's `WindowClosing` handler sets the mode back to
  `TopicPanelLastDockedSide` and emits `TopicPanelDockChanged` (doing this
  in the backend avoids depending on any particular window being alive to
  perform the revert). The topic is still selected, so the panel reappears
  docked in the main window. This and the pop-out's own dock-side menu are
  the only ways the mode leaves `window`.
- In the pop-out, the header menu still shows the dock-side row: choosing
  right or bottom calls `SetTopicPanelDock`, and the backend closes the
  pop-out window (the mode is no longer `window`, so the close handler does
  not revert anything). The panel's close (deselect) button is hidden in
  the pop-out; the window close button is the way out.
- If the connection disconnects, the existing `deselectTopic` flows through
  `TopicWindowSelect` with an empty topic and the pop-out shows the empty
  state.

Multiple connections may each have their own pop-out, mirroring chart
windows. The dock mode itself stays global.

## Inside the panel

No component inside the panel changes its API. Verify at bottom-dock
proportions (wide and short) that MessageTimeline (fixed 100px), the tab
bar, PayloadTab and ChartView all lay out correctly, and that ChartView
resizes when the panel moves between docks.

## Design system and quality gates

- Follow `frontend/AGENTS.md`: Svelte legacy syntax, token utilities only,
  colocated spec + story updates for every component whose props or variants
  change (ResizableContainer at minimum; SelectedTopicPanel spec/story if
  its props change).
- Add or update a story that shows the panel in both docked orientations so
  the layout can be reviewed in Storybook.
- Gates: `go build ./...`, `go vet ./...`, `just test`, `pnpm check`,
  `pnpm test:run`, `pnpm build`, `pnpm ds:validate`, `pnpm test-storybook`.
- Regenerate bindings with `wails3 task common:generate:bindings` after
  adding the backend method and events; never hand-edit
  `frontend/bindings/`.
