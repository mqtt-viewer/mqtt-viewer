# Topic context menu, retained tracking, and retained cleanup

Status: implemented. See the decisions log for what changed during the build.
Discussion: https://github.com/mqtt-viewer/mqtt-viewer/discussions/83
Stacked on: PR #76 (`feat/topic-graph-view-final`) — this branch targets that
branch, not `develop`.

## Goal

Give topics a right-click context menu in both the list tree and the Topic
Graph, offering the same actions as each other and as the selected-topic side
panel: copy topic path, copy payload, export message history, clear the
retained message, and clear every retained message below a prefix. Clearing is
guarded by a confirmation naming the topic or prefix and the number of retained
messages affected.

Producing that number requires per-topic retained tracking, which the app does
not have today. That tracking is the substantive part of this work; the menu is
the surface on top of it.

## Non-goals

- Persisting retained state across restarts. The index is in-memory and
  session-scoped, rebuilt from retained replay on reconnect.
- Fixing MQTT v3's retained blind spot (see Background). Not solvable without
  disruptive resubscribes.
- Retained-based filtering, search, or sorting. The graph spec lists these as
  future work (`docs/topic-graph-view-spec.md` §6); they stay future work.
- Changing the graph's existing visual encoding (size = rate, colour =
  recency).
- Multi-select or bulk topic operations.

## Background

Codebase facts an implementer needs. All line numbers are as of the base of
this branch.

### Retained state does not exist today

`MqttMessage.Retain` (`backend/mqtt/message.go:16`) is a per-message flag,
populated from the broker: v5 `Retain: m.Retain` (`message.go:59`), v3
`Retain: (*m).Retained()` (`message.go:88`). It is already exposed to the
frontend — `frontend/bindings/mqtt-viewer/backend/mqtt/models.ts:107` has
`"retain": boolean`. **No new binding is needed for the flag itself.**

Nothing derives a per-topic "this topic currently has a retained value" state.
`MessageHistory` (`backend/mqtt/history.go:25-32`) holds `recent`, `head`,
`latest map[string]*MqttMessage`, `totalBytes`, `budgetBytes` — no retained
index. Neither the tree's `MqttData` node
(`frontend/src/views/Connection/DataView/components/MqttDataPanel/stores/mqtt-data.ts:8-18`)
nor the graph's `TopicNode`
(`.../MqttGraphView/topic-model.ts:9-41`) carries a retained field.

### The v3 caveat, which ships as a known limitation

v5 subscribes with `RetainAsPublished: true` (`backend/mqtt/subscribe.go:58`),
so live retained publishes keep `Retain: true`. **v3 has no equivalent**
(`subscribe.go:26`): under MQTT 3 the flag is true only for messages replayed
at subscribe time. Consequence: on a v3 connection, a topic that another client
retains mid-session is not detected. The index is therefore "retained messages
I know about", never "retained messages on the broker". All user-facing copy
must respect that distinction and must not overclaim.

`latest` is likewise a last-seen map, not a retained map, so it cannot be
reused as-is for this.

### Clearing a retained message

Already implemented for a single topic: `DeleteRetainedMessage(connId, topic)`
(`backend/app/mqtt.go:167-179`) publishes a zero-length retained payload via
`PublishMqtt`. Bound at
`frontend/bindings/mqtt-viewer/backend/app/app.ts:121-123`.

It is called from `DataView.svelte:96-108` with **no confirmation and no
success toast** — a broker-side destructive action fires on a single click
today. This spec changes that.

Known quirk, out of scope but worth not being surprised by: `DeleteRetainedMessage`
builds `PublishParams` with a zero-value `Properties`, so on v5 a
`MessageExpiry: 0` property rides along on the clear publish
(`mqtt.go:201`, `:223`).

### The prefix primitive

`MessageHistory.GetHistoryByTopicPrefix(prefix)` (`backend/mqtt/history.go:122`)
is the existing prefix-scan, walking `recent[head:]` with `strings.HasPrefix`
and unioning in `latest`. It does **not** filter on `Retain` and is not bound to
the frontend (only caller: `GetSysMessageHistory`, `backend/app/mqtt.go:102`,
hardcoded to `"$SYS/"`). New methods follow its shape and locking.

### The list tree

Chain: `DataView.svelte:175` → `MqttDataPanel.svelte:54` →
`MqttTopicTree.svelte:44` → `MqttTopicRow.svelte`.

- Rows render through `@sveltejs/svelte-virtual-list` (`MqttTopicTree.svelte:38`)
  at a fixed `itemHeight={19}`. **This is the app's hottest render path** — see
  Performance.
- `TreeRow` (`.../MqttTopicTree/build-tree.ts:6-16`) carries `topic` (the full
  slash-joined path), `topicLevel` (the segment label), `expandKey` (identical
  to `topic`, `build-tree.ts:60`), `message?: string`, and counts. It does
  **not** carry children or a parent link.
- `message === undefined` is load-bearing: it means "intermediate branch node
  with no value of its own" (`mqtt-data.ts:179`), and `MqttDataPanel.svelte:64`
  branches on exactly that.
- Left-click on a valueless branch toggles expansion; on a node with a value it
  selects (`MqttDataPanel.svelte:63-69`).
- Row-level action precedent: `onOpenBrokerStatus` (`MqttTopicRow.svelte:25`,
  wired at `MqttTopicTree.svelte:56-58`) is an optional callback, deliberately
  `undefined` for all but the `$SYS` row, with a performance rationale in the
  comment at `:21-24`.

### The graph view

`.../MqttGraphView/` (`MqttGraphView.svelte`, `pixi-graph.ts`, `topic-model.ts`,
`tidy-layout.ts`, `cooldown.ts`). PixiJS v8 canvas, `Application` initialised at
`pixi-graph.ts:238-275`.

- **Its own data model.** The graph does not read the `mqtt-data` store
  reactively. It takes a one-shot `initialData={$mqttDataStore}` seed
  (`MqttDataPanel.svelte:85`, consumed once at `MqttGraphView.svelte:380`) and
  then runs its own Wails subscription (`MqttGraphView.svelte:343-357`),
  parallel to the store. This isolation is deliberate; preserve it.
- `TopicNode` (`topic-model.ts:9-41`) knows `topic` (full path), `name`,
  `parent`, `children`, `expanded`, EWMA scores, counts, and
  `descendantCount`. It knows **no payload and no retained state**.
  `model.ingest(topic, tMs)` (`topic-model.ts:102-135`) receives only a topic
  and a timestamp.
- Hit testing is Pixi's `eventMode`/federated events, no manual coordinate
  math. The node circle sprite is the hit target, wired in `createVisual`
  (`pixi-graph.ts:778-837`); its `pointertap` closure already captures `node`.
- **Right-press currently pans.** Stage `pointerdown` (`pixi-graph.ts:449-453`)
  ignores `e.button`. Nothing calls `preventDefault` on the native
  `contextmenu`. Nothing subscribes to Pixi's `rightclick`/`rightdown`.
- Pan mutates `world.position` (`pixi-graph.ts:475-476`); wheel zoom mutates
  `world.scale`, clamped `[0.1, 4]` (`:437-438`). `dragMoved`
  (`pixi-graph.ts:203`, set at `:471`) is the existing click-vs-drag guard.
- Collapsed nodes aggregate their subtree and show a `+N` badge from
  `descendantCount` (`pixi-graph.ts:1008-1014`), positioned
  `badge.x = r + 9 + label.width + 8`. The model keeps the whole tree regardless
  of expansion, so a collapsed node can always enumerate its descendants by
  walking `node.children`.
- **Fullscreen trap.** `toggleFullscreen` (`MqttGraphView.svelte:519-523`) calls
  `requestFullscreen()` on `containerEl.parentElement`. Existing overlays are
  children of `containerEl` and survive. **Anything portalled to
  `document.body` disappears in fullscreen.**
- Overlay precedent: the hover tooltip (`MqttGraphView.svelte:681-695`),
  absolutely positioned inside the relative `containerEl` from `e.global.x/y`
  supplied by the renderer, with edge-flip logic at `:283-288`. All existing
  overlays are `pointer-events-none`; a menu cannot be, which is new territory
  here.
- The minimap is a screen-space `Container` on the stage with a full-bounds
  `hitArea` (`pixi-graph.ts:262-293`), so it swallows pointer events in the
  bottom-right corner.

### The side panel

`.../SelectedTopicPanel/SelectedTopicPanel.svelte`. Its `DropdownMenu`
(`:132-171`) offers: auto-select (Switch), compare (Switch), Export message
history, Delete retained message. Both action props are
`(topic: string) => Promise<void>` (`:27-28`), wired at `DataView.svelte:191-192`.

**The discussion's premise is slightly wrong**: "copy topic path" is not a panel
menu action. Copy exists only as an undiscoverable click-on-the-breadcrumb in
`.../SelectedTopicPanel/components/Topic.svelte:107-122`, where clicking segment
_i_ copies the prefix up to that segment, with a 2000ms "Copied!" tooltip.

### Payload decoding

Protobuf/Sparkplug decode happens **in Go at ingest**
(`backend/mqtt-middleware/protobuf_decode.go:25-56` replaces the payload with
JSON bytes), so history already holds JSON text for those topics.

Frontend formatting is two **pure, synchronous** functions:

- `decodePayload(payload: string, codec: SupportedCodeEditorCodec)` —
  `frontend/src/components/CodeEditor/codec.ts:50`
- `formatPayload(payload: string, format: SupportedCodeEditorFormat)` —
  `frontend/src/components/CodeEditor/formatting.ts:7`

`PayloadTab.svelte:61-85` composes them as `processPayload`. Options live on the
selected-topic store (`selected-topic-store.ts:122-127`): `decoding` is
`"none" | "base64" | "hex"`, `format` is `"none" | "json" | "json-prettier" | "hex"`.
`SelectedTopicPanel.svelte:87-104` auto-sets `format` to `"json-prettier"` when
the payload parses as JSON.

The tree's cached `message` string is produced by the same `base64ToUtf8` the
store uses (`mqtt-data.ts:76-78`), so it is **byte-identical** to what the panel
renders. `formatPayload(node.message, "json-prettier")` reproduces the panel's
auto-format. No fetch needed for copy.

### Design system

`frontend/AGENTS.md` is binding. Every component folder needs the component, a
colocated `.spec.json`, and a `.stories.svelte`. Tiers: `primitive` (generic,
props-only), `component` (app-specific, may know MQTT, depends only on
primitives), `view`. No uphill dependencies. Story title is `<Tier>/<Name>`,
`tags: ['autodocs']`, `argTypes` for every enum prop matching spec options,
`parameters.design` present (`''` + `// TODO(figma-url)` when unknown).
Token utilities only, never hex. Svelte 4 syntax on Svelte 5 — do not rewrite to
runes. `pnpm ds:validate` is the CI gate.

`components/ContextMenu/ContextMenu.svelte` exists but is **dead unmodified Melt
UI demo scaffolding**: hardcoded `personsArr` of Melt maintainer names
(`:39-44`), a "Right click me." trigger (`:48`), "About Melt UI" items, and raw
`bg-white`/`text-blue-900`/`bg-blue-500` styling (`:105-150`) that violates the
token rule. Zero call sites outside its own story.

The real in-use menu is `components/DropdownMenu/DropdownMenu.svelte` (melt
`createDropdownMenu`, 11 call sites), which puts melt elements on Svelte context
via `setContext("menu-elements", elements)` (`:59`) so `DropdownMenuItem` needs
no prop drilling. Follow that pattern.

Confirmation precedent: `components/Dialog/Dialog.svelte` (takes `isOpen` as a
**store**, not a boolean), wrapped by
`.../Sidebar/components/ConfirmDeleteDialog.svelte` (props `isOpen`, `title`,
`description`, `onConfirm`; hardcodes "This cannot be undone."; Cancel + a
`text-error` Delete button). Call-site pattern: a menu item sets
`$isDeleteOpen = true`, the dialog renders as a sibling at the bottom of the
file (`ConnectionRow.svelte:137-152`).

Clipboard: browser API only, no Wails binding. `util/copy.ts` is a 3-line
`navigator.clipboard.writeText` wrapper. Copy feedback convention is **inline,
not toast** (`CopyToClipboard.svelte` swaps icon + tooltip to "Copied"). Toasts
come from `addToast` exported by `components/Toast/Toast.svelte`
(`ToastData: { title, description, type: "error" | "info" | "success" }`).

Retained colour: the message timeline renders retained markers as
`background-color: var(--secondary)` at full opacity, versus `--primary` at 0.55
for normal ones (`MessageTimeline.svelte:639-651`). **The retained indicator uses
the `secondary` token** so the two surfaces agree.

## Design

### Layer 1 — backend retained index

`backend/mqtt/history.go`. Add to `MessageHistory`:

```go
// retained tracks topics we currently believe hold a retained message.
// Maintained from the Retain flag: a retained non-empty payload marks a topic,
// a retained zero-length payload (the MQTT tombstone) unmarks it. Bounded by
// topic cardinality, like latest. Session-scoped, never persisted.
//
// This is "retained messages we know about", NOT broker truth. Under MQTT 3
// the Retain flag is only set on subscribe-time replay (subscribe.go:26 has no
// RetainAsPublished equivalent), so a topic retained by another client
// mid-session goes undetected.
retained map[string]struct{}
```

Maintained in the existing ingest path, under the existing `mutex`, alongside
the `latest` update. Rule:

- `msg.Retain && len(msg.Payload) > 0` → `retained[topic] = struct{}{}`
- `msg.Retain && len(msg.Payload) == 0` → `delete(retained, topic)`
- `!msg.Retain` → no change

Eviction (`evictLocked`, `history.go:75-92`) only trims `recent` and must not
touch `retained`, same as it does not touch `latest`.

Two new methods, mirroring `GetHistoryByTopicPrefix`'s shape and locking:

```go
func (m *MessageHistory) IsRetained(topic string) bool
func (m *MessageHistory) RetainedUnderPrefix(prefix string) []string  // sorted
```

`RetainedUnderPrefix` iterates `retained` with `strings.HasPrefix` and returns
sorted paths for a stable confirmation list. Prefix semantics: `"a/b"` matches
`"a/b"` itself and anything under `"a/b/"`. It must **not** match `"a/bc"` —
implement as `t == prefix || strings.HasPrefix(t, prefix+"/")`.

### Layer 2 — bindings

`backend/app/mqtt.go`:

```go
func (a *App) GetRetainedTopicsUnderPrefix(connId uint, prefix string) ([]string, error)
func (a *App) DeleteRetainedMessages(connId uint, topics []string) error
```

`DeleteRetainedMessages` loops the existing single-topic clear logic. It takes an
**explicit topic list, not a prefix**, so we clear exactly what the confirmation
counted. A prefix-based delete would re-resolve at execution time and could
sweep up a topic that became retained between the dialog opening and Delete
being clicked — the dialog's number would then be a lie.

Partial failure: attempt every topic, collect errors, return a joined error
naming how many succeeded and how many failed. Do not abort on first failure —
a half-cleared branch with no report is worse than a full attempt.

Regenerate bindings with `wails3 task common:generate:bindings`. Update the
Storybook binding mocks at
`frontend/.storybook/mocks/bindings/mqtt-viewer/backend/app/app.ts`.

### Layer 3 — the menu components

**`components/ContextMenu/ContextMenu.svelte`** — rewrite the dead demo as a
real primitive on melt's `createContextMenu`, whose trigger opens at the pointer
automatically. Mirror `DropdownMenu`'s architecture: `setContext("menu-elements",
elements)` so items need no prop drilling; reuse `DropdownMenuItem` rather than
inventing a second item component. Design tokens only. Props include a `portal`
target (default `undefined`), because the graph must portal into its own
container, not `document.body`, to survive fullscreen.

**One instance per view, not per row.** The trigger is the view's container; the
view resolves which topic sits under the cursor. A menu per row would multiply
floating-ui instances across a virtualised list on the hottest path.

**`.../DataView/components/TopicContextMenu/TopicContextMenu.svelte`** (tier:
`component`) — the shared MQTT menu. Props:

```ts
export let topic: string | null;          // null = closed / no target
export let hasPayload: boolean;           // false for valueless branch nodes
export let isRetained: boolean;           // this exact topic holds a retained msg
export let retainedBelowCount: number;    // known retained topics strictly below
export let onCopyTopic: (topic: string) => void;
export let onCopyPayload: (topic: string) => void;
export let onExport: (topic: string) => Promise<void>;
export let onClearRetained: (topic: string) => void;
export let onClearRetainedBelow: (prefix: string) => void;
```

Item order and enablement:

| Item | Shown when | Disabled when |
| --- | --- | --- |
| _topic path header_ | always | non-interactive |
| Copy topic path | always | never |
| Copy payload | `hasPayload` | never |
| Export message history | `hasPayload` | never |
| Clear retained message | always | `!isRetained` |
| Clear retained messages below | `retainedBelowCount > 0` | never |

The topic path is a **non-interactive header at the top of the menu**. Because
right-click does not change selection (see Decisions), the header is what makes
the menu's target unambiguous when it differs from the selected topic. Truncate
with the middle elided for long paths.

**`.../DataView/components/ConfirmClearRetainedDialog.svelte`** — follows
`ConfirmDeleteDialog`'s shape (`isOpen` as a store, `onConfirm`, Cancel +
destructive button). It must name the topic or prefix and the count, and must
not overclaim given the v3 caveat. Copy follows `docs/WRITING_STYLE.md` (first
person singular, British spelling, no em dashes, no emojis).

Single topic:

> **Clear retained message?**
> I'll publish an empty retained message to `foo/bar/baz`, which tells the
> broker to drop its retained value.

Branch:

> **Clear retained messages below foo/bar?**
> I'll clear 12 retained messages that I know about below this topic. If a
> client retained something here that I haven't seen, I won't clear it.

The second sentence of the branch copy is the honest v3 hedge. Keep it.

### Layer 4 — wiring

`DataView.svelte` gains, alongside its existing `deleteRetainedMessage` /
`exportTopicMessages` (`:96-134`):

- `copyTopicPath(topic)` — `navigator.clipboard.writeText` via `util/copy.ts`.
- `copyPayload(topic)` — resolve the payload, format as the panel does, copy.
- `clearRetainedUnderPrefix(prefix)` — fetch the list, open the confirm dialog,
  clear on confirm.
- `deleteRetainedMessage` is **changed to route through the confirm dialog**
  rather than firing immediately, and gains a success toast.

These are passed to `MqttDataPanel` (which hosts the tree's menu), to
`MqttGraphView`, and to `SelectedTopicPanel`.

**Tree.** `MqttTopicRow.svelte` gains `data-topic={topic}` on its row body div
(`:108-121`); no per-row listener, no new callback prop. `MqttDataPanel.svelte`
hosts one `ContextMenu` whose trigger is the scroll container (`:52`) and
resolves the target via `event.target.closest("[data-topic]")`. If the resolve
misses (right-click on empty space below the rows), suppress the menu.

Branch/leaf: `hasPayload = row.message !== undefined`. `retainedBelowCount` comes
from a `GetRetainedTopicsUnderPrefix` call made **when the menu opens**, not
per-row.

**Graph.** In `pixi-graph.ts`:

- `createVisual` (`:778-837`) — subscribe the circle sprite to `rightclick`,
  firing a new `GraphCallbacks.onContextMenu?(topic, x, y)` from `e.global`,
  exactly as the existing `onHover` does (`:800-806`).
- Stage `pointerdown` (`:449-453`) — **pan only on left button, and only when
  the press is not on a node.** Guard on `e.button !== 0` and on the press
  target being the stage rather than a node sprite.
- Suppress the browser's native `contextmenu` on the canvas, mirroring the
  `preventDefault` already used for `wheel` (`:427`).
- Expose a public accessor for the world transform if the menu needs
  node → screen conversion; `world` is currently `private` (`:85`). Prefer
  passing `e.global` straight through, which needs no accessor.

In `MqttGraphView.svelte`: host one `ContextMenu`, portalled to `containerEl`,
positioned from the callback's `x`/`y` using the tooltip's existing edge-flip
approach (`:283-288`). Right-click on empty canvas opens nothing.

Graph payload: `MqttGraphView` takes the per-connection `mqttDataStore` as a new
prop, read **once, imperatively, in the menu-open path only** (a `get(store)`
lookup by topic path). No reactive subscription — the graph's perf isolation
from the store is deliberate and must survive this change.

Graph branch target: any node with `children.size > 0`, whether expanded or
collapsed. `retainedBelowCount` for the graph comes from the same
`GetRetainedTopicsUnderPrefix` binding, so both views agree.

### The retained indicator

Both views. Colour: the `secondary` token, matching the timeline
(`MessageTimeline.svelte:649`). Very subtle. No Figma round trip; self-review
with a design pass, then human review in the live app.

**Data path.** The frontend mirrors retained state from the same `retain` field
the backend uses, so the indicator costs no binding call:

- `mqtt-data.ts` — add `isRetained: boolean` to the `MqttData` node type
  (`:8-18`) and maintain it in `insertMqttMessage` (`:116`) with the same
  mark/unmark rule as Go. Intermediate nodes created at `:179` default to
  `false`. Add `isRetained` to `TreeRow` (`build-tree.ts:6-16`).
- `topic-model.ts` — extend `ingest(topic, tMs)` (`:102-135`) to
  `ingest(topic, tMs, retained)` and store `ownRetained: boolean` on
  `TopicNode`. The graph's Wails source (`MqttGraphView.svelte:343-357`) has the
  full message; the one-shot `seed` (`:165-184`) passes the store's
  `isRetained`.

This deliberately derives retained state in **two places** — Go for counts and
clearing, TypeScript for display — from one shared rule. Accepted rather than
hidden: a per-row binding call for display would be far worse, and the rule is
three lines. If they ever disagree, Go is authoritative; the indicator is
cosmetic.

**Tree rendering.** A small dot in `MqttTopicRow.svelte`, rendered only when
`isRetained`. Row height is a fixed 19px (`MqttTopicTree.svelte:38`) — the
indicator must not change row height or the virtual list's geometry breaks.

**Graph rendering.** A small dot to the **right of the label, after the `+N`
badge**, so it never crowds the badge. Current layout in `refreshVisualDetail`
(`pixi-graph.ts:1008-1014`) is: circle (radius `r`), label at `r + 9`, badge at
`r + 9 + label.width + 8`. The dot goes after the badge when one is shown, after
the label otherwise. Use the existing badge pooling pattern (`acquireBadge`)
rather than allocating per frame. Not a ring: the collapsed-aggregate ring
already owns that visual language (`pixi-graph.ts:1250-1261`).

## Implementation

Ordered, each step independently verifiable.

1. **Retained index in Go.** `backend/mqtt/history.go`: add the `retained` map,
   maintain it on ingest, add `IsRetained` and `RetainedUnderPrefix`. Verify:
   `go build ./... && go vet ./...`, plus new unit tests in
   `backend/mqtt/history_test.go` (see Testing).
2. **Bindings.** `backend/app/mqtt.go`: `GetRetainedTopicsUnderPrefix`,
   `DeleteRetainedMessages`. Regenerate with
   `wails3 task common:generate:bindings`; update the Storybook binding mocks.
   Verify: `go build ./...`, `just test`, and the generated TS compiles under
   `pnpm check`.
3. **`ContextMenu` primitive.** Rewrite from the melt demo. Add/refresh
   `ContextMenu.spec.json` and `ContextMenu.stories.svelte`. Verify:
   `pnpm ds:validate`, `pnpm test-storybook`.
4. **`TopicContextMenu`** + **`ConfirmClearRetainedDialog`**, with colocated
   spec + stories. Verify: `pnpm ds:validate`, `pnpm test-storybook`.
5. **Tree wiring.** `data-topic` on the row, one menu in `MqttDataPanel`,
   handlers in `DataView`. Route the existing single-topic clear through the
   confirm dialog. Verify: manual in `just dev` against a local broker with
   retained messages.
6. **Side panel parity.** Add copy topic path + copy payload to the panel menu.
   Leave the breadcrumb's per-segment copy alone — it copies a partial prefix,
   which the menu cannot. Verify: manual.
7. **Graph input changes.** Right-click callback on the node sprite; pan
   restricted to left-button-not-on-node; native `contextmenu` suppressed.
   Verify: manual, and confirm pan/zoom/minimap/fullscreen all still behave.
8. **Graph menu.** Host the menu portalled into `containerEl`, pass the
   `mqttDataStore` prop for the one-shot payload read. Verify: manual, including
   **in fullscreen**.
9. **Retained indicator.** `mqtt-data.ts` + `build-tree.ts` + `MqttTopicRow`
   (list), then `topic-model.ts` + `pixi-graph.ts` (graph). Verify: manual, plus
   a design pass; row height unchanged.
10. **Changelog.** Add a "What's new" entry via the `/changelog` skill.
11. **Full gate.** `go build ./...`, `go vet ./...`, `just test`, `pnpm check`,
    `pnpm test:run`, `pnpm build`, `pnpm ds:validate`, `pnpm test-storybook`,
    then **`/perf-check`**.

## Edge cases

Every guess-point, with its decided answer.

| Case | Decision |
| --- | --- |
| Right-click changes selection? | **No.** Menu opens, selection untouched. The menu's topic header disambiguates. |
| Right-click a valueless branch node | Menu opens without Copy payload or Export. Does **not** toggle expansion. |
| Right-click empty canvas / below the rows | No menu. |
| Topic has no retained message | Clear retained message shown but **disabled**. |
| Nothing retained below a branch | Clear retained messages below **hidden entirely**, not disabled. |
| Branch clear scope | Whole subtree, any depth, regardless of expansion state or the active search filter. |
| Prefix matching | `a/b` matches `a/b` and `a/b/**`, never `a/bc`. |
| Count changes between dialog opening and confirm | We clear the explicit list captured when the dialog opened. Newly retained topics are not swept up. |
| Partial failure clearing a branch | Attempt all, report succeeded/failed counts in an error toast. |
| Not connected to the broker | `Publish` already returns "no connection to broker" (`backend/mqtt/publish.go:22-25`). Surface as an error toast. |
| MQTT v3 undercount | Ships as a known limitation, hedged in the dialog copy. |
| Index after reconnect | Rebuilt from retained replay at subscribe. Briefly empty between connect and replay. |
| Menu open while messages stream in | Counts are captured at open; the menu does not live-update. |
| Menu open while the graph relayouts / follow-hottest pans | Menu stays at its opened screen position. Node positions are not stable (`viewAnim` `:1264`, `followHottest` `:1287`), so anchoring to the node would make it drift. |
| Menu in graph fullscreen | Must work: portal to `containerEl`, never `document.body`. |
| Right-click over the minimap | Minimap swallows the event (`pixi-graph.ts:291-293`); no topic menu. Acceptable. |
| Copy payload on a protobuf/Sparkplug topic | Already JSON by the time it reaches the frontend (decoded in Go at ingest). Copies the JSON. |
| Copy payload formatting | Matches the panel: `json-prettier` when it parses as JSON, raw utf8 otherwise. |
| Copy feedback | Follows the in-app convention: inline where possible. A toast only if inline feedback is impossible in a closing menu. |
| Retained indicator and row height | Must not alter the fixed 19px row. |
| `$SYS` topics | No special-casing. Clearing retained on `$SYS` is a broker concern, not ours. |

## Testing

**Go unit** (`backend/mqtt/history_test.go`, alongside the existing tests):

- Retained non-empty payload marks the topic.
- Retained zero-length payload unmarks it.
- Non-retained messages never change the index.
- `RetainedUnderPrefix` returns descendants at any depth, sorted.
- `RetainedUnderPrefix("a/b")` excludes `a/bc` (the prefix-boundary bug).
- Eviction under byte pressure does not drop retained entries.
- `RetainedUnderPrefix("")` behaviour is defined and tested.

**Go app-level** (`backend/app/`, `getTestApp(t)` pattern with golden dirs under
`backend/app/_test/<TestName>/` per CLAUDE.md):

- `GetRetainedTopicsUnderPrefix` returns what the index holds.
- `DeleteRetainedMessages` publishes a zero-length retained payload per topic.
- Partial failure reports counts rather than aborting.

**Frontend unit** (`pnpm test:run`):

- `mqtt-data.ts`: `isRetained` marks/unmarks per the same rule
  (extend `mqtt-data.test.ts`).
- `topic-model.ts`: `ingest` carries retained through
  (extend `topic-model.test.ts`).
- `TopicContextMenu` item visibility/enablement across the branch/leaf ×
  retained/not matrix.

**Storybook** (`pnpm test-storybook`): stories for `ContextMenu`,
`TopicContextMenu`, `ConfirmClearRetainedDialog`. Registry count rises; keep
`ds:validate` green.

**Manual, in `just dev` against a local broker with retained messages**:

- Both views: menu opens on right-click, correct items for branch vs leaf.
- Copy topic path and copy payload produce identical text from both views and
  the panel.
- Single clear and branch clear both confirm, then actually drop the retained
  value (verify with `mosquitto_sub -t '#' -v` on reconnect).
- Graph: left-drag on empty canvas still pans; right-press does not pan; native
  browser menu never appears; pan/zoom/minimap/fit/follow-hottest unaffected.
- Graph menu works **in fullscreen**.
- Retained indicator visible and subtle in both views, light **and** dark theme.
- Row height unchanged in the list.

**Performance** (`/perf-check`, mandatory): this touches message handling,
history, the tree, and the graph — every trigger in the CLAUDE.md perf bar. The
app must stay smooth with two brokers at ~2000 msg/s each. Watch specifically:
the retained map write on the ingest path, and the graph's per-frame indicator
draw.

## Decisions log

| Decision | Rationale |
| --- | --- |
| Track retained per topic, honest count | User choice. The alternative (clear every known topic under the prefix) publishes to non-retained topics and makes the count meaningless. |
| Session-only in-memory index | User choice. Persisting risks showing counts for retained messages another client cleared while the app was closed — stale state that lies about the broker is worse than no state. Also avoids a GORM model + Atlas migration. |
| Confirm both branch **and** single-topic clears | User choice. Fixes today's fire-immediately-on-click behaviour for a broker-side destructive action. |
| Copy payload matches the panel exactly | User choice. Cheap because `decodePayload`/`formatPayload` are pure and the tree's cached string is byte-identical to the panel's. |
| Rewrite `ContextMenu` as a real primitive | User choice. The existing file is unmodified Melt demo scaffolding with token violations and zero call sites; deleting it removes dead code rather than adding a parallel component. |
| One menu instance per view, not per row | The tree is virtualised on the app's hottest render path; a floating-ui instance per row is waste. Also the only design that works for a Pixi canvas. |
| Right-click does **not** change selection | User challenged the OS precedent (Finder/VS Code select on right-click) and was right for this app: `selectTopic` (`selected-topic-store.ts:167`) is async and can load 5000 history messages off disk, so right-clicking to copy a path would trigger a disk read and repaint the panel. The destructive path is already guarded by a dialog naming the topic, so the divergence risk is cheap where it exists. Mitigated by the topic header in the menu. |
| Full parity both directions, including Export in the tree menu | User choice, chosen over my recommendation to keep Export panel-only. |
| Branch clear ignores the active search filter | User choice. "Clear what I can see" is a subtle rule to attach to a destructive action. |
| Explicit topic list passed to the delete binding | Guarantees we clear exactly what the confirmation counted; a prefix re-resolved at execution time could sweep up newly-retained topics. |
| Retained indicator in **both** views | User choice, overriding my list-only recommendation. To be judged visually in the live app. |
| Indicator is a dot, not a ring, placed right of the label after the `+N` badge | User choice. A ring would collide with the collapsed-aggregate ring's existing visual language. |
| Indicator uses the `secondary` token | User choice: match the message timeline's retained colour (`MessageTimeline.svelte:649`). |
| Retained state derived in both Go and TS | Accepted duplication. A per-row binding call for display would be far worse; the rule is three lines. Go is authoritative if they disagree. |
| Graph reads the mqtt-data store one-shot at menu-open only | Preserves the graph's deliberate reactive isolation from the store while still giving identical copy output in both views. |
| Graph pan restricted to left-drag not on a node | User choice, to free right-press for the menu. **Open risk:** a drag starting on a node currently pans and would become a dead gesture, since nodes are not movable. Revisit if it feels broken in the live app. |
| Menu portalled to `containerEl`, not `document.body` | `requestFullscreen()` targets `containerEl.parentElement` (`MqttGraphView.svelte:519`), so a body-portalled menu vanishes in fullscreen. |
| Stacked on PR #76 | User instruction. #76 touches `history.go`, `message.go`, `mqtt-data.ts`, `SelectedTopicPanel.svelte`, and `MqttDataPanel.svelte` — every file this work needs. Building on `develop` would guarantee conflicts. |

### Changed during implementation

| Change | Why |
| --- | --- |
| The graph resolves its right-click target by hit-testing the native event (`TopicGraphRenderer.topicAt`), not from a Pixi `rightclick` handler on the node sprite as the Design section said. | Pixi's synthetic `rightclick` and the browser's `contextmenu` event have no guaranteed ordering, so resolving on one and opening on the other is a race. Hit-testing in the menu's `onOpen` also makes both views use one mechanism. Pixi's `pointertap` fires for every button, so it needed an `e.button !== 0` guard or a right-click would select/expand the node too. |
| `ContextMenu`'s `portal` prop is a CSS **selector**, not an element. | Found in review. `portal={containerEl}` reads `undefined`, because `bind:this` is assigned after the child component is constructed, and melt treats an undefined portal as "portal to body" (`getPortalDestination`, `internal/helpers/elements.js:17`). That silently reintroduced the exact fullscreen bug the portal was for. A selector is resolved lazily by `usePortal` when the menu opens. |
| The graph takes `getTopicPayload`/`copyPayload` functions rather than the `mqttDataStore` itself. | Found in review. Passing the store meant copy behaviour was implemented twice, which is the drift this work exists to remove. Also keeps the graph's reactive isolation without it needing to know the store exists. |
| `MessageHistory.Clear()` also resets the retained index. | Missed by the spec. Clearing history without clearing the index would leave counts for topics whose history is gone. |
| `mqtt-data.ts` tracks retained across a whole batch, not from the last message per topic. | The store collapses each batch to the last message per topic. A retained tombstone followed by ordinary traffic on the same topic in one drain would have lost the state change, leaving the topic marked retained. Covered by a test. |
| `MessageTimeline`'s retained/unselected colours were fixed as part of this work. | Not in the original spec's scope, but the indicator was specified to match the timeline, and the timeline's rules referenced `var(--primary)`/`var(--secondary)`, which are not defined anywhere (the tokens are `--color-*`). The rules were dead, so there was no colour to match until they were fixed. A broader audit of undefined `var()` references is spun out separately. |
| The mock graph source marks ~25% of topics retained. | The perf harness otherwise measured a graph where no node is retained, so the marker's draw and pooling cost never ran and the reported number did not describe what users get. |
