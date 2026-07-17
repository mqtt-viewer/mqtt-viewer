# Claude Design prompt — new feature UI

Paste everything below the line into Claude Design. Attach screenshots
of the current app (data view with topic tree + selected topic panel,
broker status window, connection form) if the session allows uploads —
the prompt describes the visual language but screenshots anchor it.
Full build specs live in docs/specs/research/ if deeper context is wanted:
stateful-sparkplug-decode.md, retained-message-manager.md,
topic-rate-ranking.md, per-topic-protobuf-binding.md.

---

I am designing four new features for MQTT Viewer, a cross-platform
desktop MQTT client (Go + Svelte in a Wails shell). It is a
professional debugging tool: think developer tooling density, not
consumer whitespace. I want high-fidelity UI designs for each feature.

## Product and visual language

- Desktop app, resizable panels, information-dense. Primary users are
  IoT/industrial engineers and home-automation power users debugging
  live message traffic at up to thousands of messages per second, so
  designs must respect constant motion: values update in place, rows
  must not jump under the cursor, and anything clickable needs a
  stable hit target.
- Dark theme is the default and the primary design target; a light
  theme exists and every design must work in both.
- Colour comes from a token system, not raw hex. Key tokens:
  `primary`, `secondary`, `emphasis`, `secondary-text`, `outline`,
  `divider`, `success`, `error`, `warning`, `highlight-background`,
  and a surface ladder `elevation-0` (app background) through
  `elevation-1` (panels/cards) to `elevation-2` (raised elements,
  menus), each with `-hover` and `-selected` variants. Use the ladder
  for hierarchy rather than borders where possible.
- Existing component vocabulary to reuse, not reinvent: Dialog,
  ContextMenu, DropdownMenu, Tabs, Tooltip, Toast, Button, Card,
  PanelHeader, ResizableContainer, input fields, CodeEditor
  (CodeMirror for payloads), virtualised lists for anything long.
  There are existing logo marks for Sparkplug and Protobuf used as
  small payload badges.
- Copy rules are strict: sentence case, terse, British spelling, no
  emojis, no exclamation marks. Empty states invite action in one
  short line.
- The main data view layout today: left panel is a live topic tree
  with a search/filter action bar; right panel shows the selected
  topic (tabs: Payload, Headers, User properties, plus a message
  timeline scrubber and a Chart tab). A toggle in the left panel
  header will switch between List, Graph, and the new Sparkplug view.

Design each feature below. For every screen give: default state,
empty state, error/edge states named in the brief, and both themes
for the primary screen. Desktop only.

## Feature 1: Sparkplug session view (highest priority)

A third mode of the left data panel for industrial Sparkplug B
traffic. Sparkplug devices announce metrics once in "birth" messages
(names, numeric aliases, datatypes), then stream compact data messages
carrying only alias numbers. This view is the live decoded inventory.

Structure: Group > Edge node > Device > Metrics table.

- Node/device rows: name, online/offline state, subtle health chips
  (sequence ok, bdSeq value, metric count). Offline shows how long ago
  the death message arrived.
- Metrics table per node/device: name, datatype, last value, last-seen
  age, optional badges (stale, null, historical, transient). Values
  update continuously — design for readable churn (no colour flashing
  on every tick; consider a restrained recent-change treatment).
- A slim host-status strip: the primary SCADA host id with
  online/offline and since-when.
- Warnings surface: sequence gap detected, rebirth storm (many births
  in a short window), data arriving with no birth seen (unresolvable
  aliases shown as alias_3 placeholders). Warnings need a home that
  does not shove the tree around — pinned strip, badge on the toggle,
  or both. Propose the pattern.
- Context menu on a node: request rebirth (the active debugging
  action), copy metric list, export session.
- Empty state: connection has Sparkplug traffic but no births seen yet
  — explain aliases may be unresolved and offer the rebirth request.
- Also design the enhanced Payload tab banner shown when a selected
  Sparkplug message has been alias-resolved: which birth resolved it
  and when, plus the unresolved variant with a request-rebirth action.

## Feature 2: Retained message manager

A dialog opened from the data panel action bar. Retained messages are
values the broker stores forever and replays to new subscribers; stale
ones cause real-world ghosts, so this is a housekeeping tool.

- Virtualised table: topic, age, payload size, short payload preview.
  Sortable by age/size/topic; filter field; multi-select checkboxes.
  Can hold tens of thousands of rows.
- Header: count + total bytes, a filter input, and a "deep scan"
  action (temporarily subscribes to everything to sweep the broker;
  needs progress + cancel states and a warning variant when the
  broker refuses).
- Actions: clear selected, clear subtree (opens a picker or acts on a
  selected folder-like filter). Clearing is destructive and affects
  every client on the broker, so the confirmation dialog is part of
  the brief: it states the topic count and that this cannot be undone.
- Per-row failures after a batch clear (broker denied some topics)
  need a results state — design it.
- Rows link back to the topic in the main window.

## Feature 3: Top topics panel (broker status window)

The existing broker status pop-out window gains a "what is flooding my
broker" section: a ranked table of topics by message rate.

- Columns: topic (with expandable subtree rollup rows), messages per
  second, bytes per second, share-of-total with a proportional bar.
- Controls: time window selector (10s/60s/5m), sort mode, pause,
  export CSV. Pause must be visually unmistakable so a frozen ranking
  is never mistaken for live data.
- Rows click through to select the topic in the main window.
- Empty state: no traffic observed yet.
- Must sit harmoniously below the existing $SYS metric cards in that
  window.

## Feature 4: Protobuf binding rules (connection form section)

The connection form gains per-topic protobuf schema binding: users
point the connection at a directory of .proto files, then map topic
patterns to message types.

- A rules table inside the form: topic filter (text input, MQTT
  wildcards allowed), message type (dropdown populated after schemas
  compile), drag-to-reorder handle, delete. Most-specific rule wins;
  order breaks ties — the design should make the precedence idea
  legible without a paragraph of explanation.
- States: schema directory not yet chosen; compiling; compile error
  (error text from the proto compiler, can be long — design the
  truncation/expand); rules referencing a type that no longer exists
  after a recompile (invalid-rule row state).
- A small badge appears on decoded messages elsewhere in the app
  showing which message type decoded them — design the badge and its
  tooltip (existing Protobuf logo mark can anchor it).
- Publish panel addition: when the publish topic matches a rule, show
  the resolved type inline with an override dropdown.

## Deliverables

For each feature: primary screen in dark and light, the named states,
and a short rationale note per screen (a sentence or two, not an
essay). Flag any place where you think the existing component
vocabulary is insufficient and a new design-system component is
warranted — new components carry extra cost here (spec + Storybook
gates), so call them out explicitly rather than inventing silently.
