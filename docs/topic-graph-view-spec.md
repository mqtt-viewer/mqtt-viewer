# Topic Graph view — specification

Status: draft for implementation · Owner: Sam · Last updated: 2026-06-13

Companion mockups: Figma file `f1tvIf8T35FTls7kM6QJUs`, page **"🔵 Topic Graph — Exploration (Claude)"**, Direction D node `6467:24`.

---

## 1. Summary

A new way to view an MQTT broker's topic namespace as a **deterministic horizontal tree** ("tidy tree"), where each node's **size** encodes message rate and its **color** encodes recency (a red→cold "cooldown" the instant a message arrives). It is built to stay legible and smooth on very large brokers via collapse, virtualization, zoom/pan, and level-of-detail.

It is **not** a force-directed graph and has **no central broker hub**: roots stack vertically on the left and children fan out to the right on a fixed grid.

This view is a **secondary overview/monitoring surface**, not a replacement for the existing topic list. The two coexist behind a toggle.

### Primary jobs-to-be-done
1. **Spot the chatty/anomalous topic** — a flooding device is unmissable (big + red).
2. **Understand an unfamiliar broker** — namespace shape is legible at a glance.
3. **Ambient health glance** — "is the heartbeat normal?"; anomaly = a node hotter/bigger than its baseline.

### Non-goals
- Not a replacement for the indented topic list (that remains the default navigator).
- Not a payload inspector — selection reuses the existing inspector panel.
- Force-directed and radial layouts are explicitly out of scope (explored and rejected for this view; see Figma Directions A/B for the radial/force alternatives if ever revisited).

---

## 2. Placement & shell

- **Location:** a view in the **main content pane** of a connection, toggled `List ⇄ Tree`. The existing list stays the **default**; they coexist.
- **Fullscreen:** an expand-to-fullscreen button grows the Tree view to fill the window for monitoring/wall-display use.
- **Selection target:** clicking a node selects its topic and opens the payload in the **existing message inspector** (reused, not rebuilt).
- **Frontend:** Svelte 5 in **legacy mode** (`export let`, `$:`, `on:event`) — do not use runes (matches repo convention).

---

## 3. Layout algorithm

Deterministic **Reingold–Tilford tidy tree** (`d3-hierarchy` / `d3.tree`), laid out **left → right**.

- **Roots** (top-level topic segments) stack **vertically** down the left edge.
- **Depth = column.** Fixed horizontal spacing per level (`colW`, proposed 220–300px).
- **Each visible node = one row.** Fixed vertical spacing (`rowH`, proposed 28–34px).
- **Parents are centered** on the vertical span of their visible children.
- **Connectors:** orthogonal **elbow** links (right-angle), drawn beneath nodes. No diagonals, no curves — reinforces the "organised grid" read and minimizes crossings.
- Positions are a **pure function of the visible-node set** → stable, diffable, cheap to animate, and trivially virtualizable.

A node = one topic-level segment (split topic strings on `/`).

### Why a tidy tree (not force/radial)
- **O(n) deterministic layout** → stable, never churns (force layouts are unstable and disorienting).
- **Virtualizable** → render only nodes within the viewport (+ margin), so 100k-topic brokers stay smooth.
- **Scannable** → depth maps to column, read like an org chart.
- **Collapse tames scale** → fold quiet branches to a `+N` chip.

---

## 4. Node model — single core, state-dependent meaning

**One core (one filled circle) per node.** Its meaning depends on collapsed/expanded state. This is the resolution to the "a topic that is both a parent and a publisher" problem.

| State | What the core represents | Size | Color |
|------|--------------------------|------|-------|
| **Collapsed** | the **subtree aggregate** | Σ of all descendant rates | hottest (most-recent) descendant |
| **Expanded** | the node's **own traffic only** | the topic's own rate | the topic's own recency |

Consequences:
- A **pure-structure** node (an intermediate that never publishes) **shrinks to a tiny junction dot** when expanded — it has no own-traffic to show.
- A **dual-role** node (publishes *and* has children) keeps a meaningful core when expanded, sized/colored by **its own** messages; it grows and resets to red when a message lands on the topic itself.
- No double-counting: "is this the node or its subtree?" is answered by whether it is open. When expanded, you read the children's colors directly, so the parent no longer needs to roll the subtree up.
- A **leaf** (no children) always shows its own traffic.

### Collapsed badge
`+N` where **N = count of descendant topics (all levels)** hidden under the node — the clearest "how much am I folding?" signal.

---

## 5. Visual encoding

### 5.1 Size = message rate (EWMA-smoothed)
- Rate is an **exponentially-weighted moving average** of message arrivals per topic (smooth, weights recent traffic, no jitter as messages age out). Proposed half-life ~10s (tunable).
- Mapping: **area ∝ rate** → `r = clamp(rMin, rMax, rMin + k·√(rateEWMA))`. Proposed `rMin ≈ 4px` (idle/structural), `rMax ≈ 22px`; `k` tuned to the broker's rate distribution.
- Collapsed-node size = **sum** of descendant rates (recursive).

### 5.2 Color = recency cooldown
Each received message **snaps the topic's core to red**, then it **cools continuously** through the ramp toward a cold endpoint as the topic idles.

- **Ramp (warm → cold):** red → orange → amber → teal → blue → cold-endpoint.
- **Cold endpoint is theme-aware:** **white** in dark mode, **dim blue** in light mode (so idle nodes never vanish into a white background).
- **Cooldown duration is configurable per connection.** Default ~**60s** red→cold; range ~5s up to **1 hour** (for low-traffic brokers that would otherwise wash uniformly cold).
- Map age→ramp position **linearly**: `t = clamp(age / duration, 0, 1)`. (A log curve was tried and cooled far too fast — a 2 msg/s topic never looked red — see §15.)
- Collapsed-node color = **max recency (hottest)** descendant — so a folded branch glows red the instant *anything* under it fires. (Size sums; color takes the max — they answer different questions.)

#### Proposed ramp stops (tunable; must be validated in both themes)
| t | meaning | color |
|---|---------|-------|
| 0.00 | just now | `#E5484D` red |
| 0.18 | ~seconds | `#E8833A` orange |
| 0.36 | | `#D9A227` amber |
| 0.56 | cooling | `#3DA98A` teal |
| 0.78 | cold | `#3D6FA5` blue |
| 1.00 | idle | dark: `#ECEAE7` white · light: `#6F8FB0` dim blue |

Color and size are **redundant-ish** but independent (rate vs recency); together a "small but red" node (rare burst on a normally-quiet topic) is itself a useful tell.

---

## 6. Interaction model

### Click & selection
- **Single click on a node body** → select the topic, open it in the existing inspector.
- **Caret/chevron** on a node (and clicking the `+N` aggregate) → **expand/collapse**. (Selection and expansion are deliberately separate actions.)
- **Keyboard:** ↑/↓ move selection, →/← expand/collapse, Enter focuses the inspector.

### Expand/collapse
- **Local insertion:** expanding pushes siblings **down in place**; the clicked node stays put (file-explorer model). Not a global relayout.
- **Anchor** the clicked node in the viewport (scroll-compensate so it doesn't jump under the cursor).
- **Animate** the slide (~220ms ease-out) to preserve object constancy.
- Defaults: on connect, **auto-collapse to depth 1–2**; a **hot folded branch may pulse** to invite a click. `Collapse all` / `Expand all` in the toolbar.

### Filter / search → prune
- Non-matching topics are **hidden** (pruned to a compact result tree); matching branches **auto-expand**.
- This is a **full reflow**, so it gets the animation budget (nodes slide to new slots; keep the selected node pinned + scrolled into view).
- Filter by text/wildcard, rate, retained, QoS.

### Sort → live, with pause
- **Per-level (sibling) sort** — sorting orders siblings within each parent, never flattens globally (that's what the List view is for).
- **Live re-sort, animated** by default — order always reflects current rate/recency, with motion as nodes reorder.
- A **Pause / Lock** control freezes the current order so it never shifts under the cursor while you work.
- Sort keys: rate, recency, alphabetical, message count.

### Zoom & pan
- Scroll to zoom, drag to pan, fit-to-view, on-screen zoom buttons.
- **Semantic zoom / level-of-detail (v1):** auto-collapse below depth N and hide labels when zoomed out; reveal detail as you zoom in. Keeps the worst-case rendered-node count in the hundreds regardless of broker size.

---

## 7. Controls & chrome (all in v1)

- **Toolbar:** search/filter, collapse-all, depth/LOD control, sort (with Pause/Lock), live toggle, fullscreen button.
- **Minimap:** overview thumbnail with a draggable viewport rectangle.
- **Follow-hottest auto-pan:** optional mode (off by default) that pans the viewport to new spikes.
- **Fullscreen mode.**
- **Status line:** `X topics · showing Y · depth ≤ N`.
- **Recency legend:** the cooldown gradient with `now / 1s / 10s / 1m / 10m / idle` labels.

---

## 8. Rendering & tech

- **Renderer: Canvas via PixiJS** (WebGL-accelerated 2D). Gives text + sprite + hit-testing out of the box; smooth per-frame color animation on thousands of nodes.
- **Wails compatibility:** WebGL works in all Wails webviews (WebView2/Chromium on Windows, WKWebView on macOS, WebKitGTK on Linux). Pixi avoids raw-WebGL pain (no hand-built SDF text/picking). Linux WebKitGTK is the main version-variance risk to smoke-test.
- **Renderer-agnostic layout/data layer:** layout + aggregation computed independently of the renderer so SVG (simple mode) or raw WebGL (100k+) could be swapped without a rewrite.
- **Animation:** a single ticker drives the per-frame cooldown; throttle and use transitions for layout changes. The cooldown animating many nodes at 60fps — not topic count — is the real perf driver; this is why Canvas/Pixi over SVG.

---

## 9. Data & semantics

- **Source:** per-topic message history + last-message timestamp already exist (backend `MessageHistory`; status bar already computes a messages/min figure). Recency = `now − lastMessageTs`; rate = EWMA over arrivals.
- **Aggregation:** collapsed parent rate = Σ descendant rates; collapsed recency = min-age (max-recency) across descendants. Computed incrementally as messages arrive.
- **Node identity:** topic-level segment; tree built by splitting topic strings on `/`.
- Wire to existing connection stores; do not duplicate message storage.

---

## 10. Performance

- **Virtualize** rendering to the viewport (+ margin).
- **Collapse + LOD** bound simultaneously-rendered nodes to the hundreds even on 100k-topic brokers.
- **EWMA** avoids per-message size thrash; cap the animated set to visible nodes.
- Target: smooth (60fps) interaction and cooldown animation on large industrial brokers.

---

## 11. Accessibility

- **Color-vision safety:** the red↔blue/teal ramp is reasonable for red-green CVD, and **size is a redundant channel**, but ship a **CVD-safe alternate ramp** toggle and never rely on hue alone for the spike signal.
- Minimum label size 11px; labels hidden only under LOD (full labels on zoom-in / hover).
- Keyboard-navigable (see §6); selection drives the same inspector as the list.

---

## 12. Settings (per connection)

- **Cooldown duration** (default ~60s, range ~5s–1h).
- **Rate EWMA window / half-life** (default ~10s).
- **CVD-safe ramp** toggle.
- **Follow-hottest** toggle.
- Persist with the connection.

---

## 13. Edge cases

- **`$SYS` and retained-only topics:** retained-on-connect messages would all flash red at once; consider seeding recency from message age so a retained value that's an hour old starts cold, not red. (Confirm.)
- **Deep single-child chains** (`a/b/c/d/...`): offer a "collapse runs" option to compress chains into one breadcrumb node.
- **Empty broker / no messages yet:** show the namespace skeleton in the idle endpoint color with an empty-state hint.
- **Topic explosion mid-session:** new top-level roots insert without relayout churn (append + animate).

---

## 14. Phasing

- **v1:** everything above — tidy-tree layout, single-core state-based nodes, EWMA size, recency cooldown (configurable, theme-aware endpoint), collapse-aggregation with `+N` descendant counts, click-select → inspector, caret expand (local insertion, animated), prune filter, live sort with Pause/Lock, zoom/pan, **minimap, follow-hottest, fullscreen, semantic-zoom/LOD**, Pixi renderer, per-connection settings, CVD-safe ramp.
- **Later / separate:** augmenting the existing **List** view with inline volume (Figma Direction C); radial/force alternate views (Directions A/B) if ever wanted.

---

## 15. Open questions / assumptions

Resolved (tuned against simulated traffic, commit fd1bb10):
1. **Cooldown curve + default** — age→ramp is **linear** (`t = age/cooldown`), default 60s. A logarithmic curve was tried first and cooled far too fast (1s stale → past teal); linear keeps actively-publishing topics warm and only cools genuinely idle ones.
2. **Size constants** — `rMin 3.5`, `rMax 20`, `k 2.4` (size = `rMin + k·√score`); EWMA half-life ~10s (`tau 14s`, "balanced"; user-selectable responsive/balanced/smooth).
3. **Light-mode cold endpoint** — `#6F8FB0` (dim blue), confirmed readable.
4. **Group spacing** — top-level namespaces use d3-tree separation 1.9 so distinct roots read as groups.

Still open (need the real app / product call):
5. **Retained-message recency seeding** (§13) — seeding from the snapshot uses `latestMessageTime` (so old retained values start cold); live retained-on-connect timestamps are a backend concern — confirm in `wails dev`.
6. Whether `$SYS` (`$app` in the sim) is shown by default or behind a toggle.
7. Minimap density representation at extreme (10k+) topic counts.
8. Final visual pass on ramp stops in the real app under real traffic.

---

## 16. References
- Figma exploration page `6467:24` (Direction D) — visual source of truth for v1.
- Directions A (radial), B (force), C (augmented list) on the same page — explored alternatives.
