# Broker Status Window v2 — density and diagnosis

Status: FINAL (survived two adversarial review cycles, July 2026)

## Goal

Upgrade the broker status window (shipped in PR #118, spec:
`docs/broker-status-spec.md`) from a status display into a diagnostic tool.
The v1 page reports state but cannot answer "is something wrong" or "who is
causing it". v2 adds failure signals, context on numbers, and client-side
per-topic insight, while keeping the app's clean, minimal look: existing
Tailwind tokens, semantic colour only where state demands it, no new
palettes.

Competitive context (researched July 2026): no desktop MQTT client has a
diagnostic status view. Density benchmarks are broker consoles (TBMQ,
HiveMQ Control Center). Per-topic stats and health signals in a client are
open territory.

## Non-goals

- No user-configurable thresholds (fixed conservative defaults).
- No cross-session persistence; no multi-broker aggregate view.
- No backend changes: CONNACK v5 capability display is cut (follow-up).
- No NanoMQ event-derived churn (NanoMQ is a no-$SYS broker in v2).
- No topic-prefix aggregation in loudest topics (follow-up).

## Layout (top to bottom, scrollable body)

Order is by universality: what works on every broker sits highest. The
body (shell change: the `grow min-h-0` wrapper gains `overflow-y-auto`)
scrolls; the window header stays pinned and the health strip is sticky at
the top of the scroll container. Intended fold at 760x560: strip + hero
(160 px) + loudest topics visible; gauges and below scroll. Loudest
topics defaults to top 6 rows (24 px each) so the fold lands after the
table footer, not mid-table.

1. **Header** (in `BrokerStatusWindow.svelte`, the shell): staleness pill
   and time-range selector.
   - Pill: "waiting for $SYS" until the first $SYS message; then
     "$SYS <age> ago", greyed once age exceeds 2x the learned interval.
     Hidden on no-$SYS brokers.
   - Ranges: 1m / 5m / 15m, default 5m. **Always enabled** — the selector
     drives the hero window and the loudest-topics window, and loudest
     topics is client-side 1 s data valid at any range on any broker.
     When the range is shorter than 5x the learned $SYS interval, the
     broker series in the hero render as sparse points with a small note
     "broker publishes about every <interval>"; nothing is disabled.
   - The selector does NOT affect health windows (fixed per rule) or tile
     sparklines (always 15m). Shell passes the range to the store via
     `setRange()`.
2. **Health strip**: compact chips, dot + label + monospaced value +
   one-word text qualifier (state never encoded by colour alone: ok is an
   outline dot with no qualifier; attention is a filled warning dot +
   qualifier; problem is a filled error dot + qualifier). A chip renders
   only once its signal has the minimum samples its rule needs; until
   then nothing renders (never paint "ok" off one sample). A chip whose
   source has been silent for `3x learnedInterval + 30 s` greys out:
   value stays, dot and qualifier drop (same grey semantics as the pill).
   The strip hides when no chip has data. When $SYS is absent entirely,
   the v1 empty-state card (kept, with its add-subscription CTA) carries
   the explanation; a separate one-line capability notice renders in the
   strip's place ONLY when the v1 card is not showing (no duplicate
   messaging): "No $SYS metrics are visible on this connection. Showing
   what this client can measure."
3. **Traffic hero chart** (ECharts): msgs/s in and out co-plotted,
   client-observed third series (dashed, muted when broker series
   present; promoted to solid primary when alone). ECharts legend is
   disabled (`legend: {show: false}`); a custom HTML legend row above the
   chart carries live values at tile weight: flex row, `tabular-nums`,
   fixed-min-width value slots (no 1 Hz reflow jitter), colour swatches
   from the shared chart colour exports, app `Tooltip` per item. In/out
   item tooltips name the smoothing and show the broker's 5m/15m
   averages where published ("1 min average, from the broker; 5m: X,
   15m: Y"); the observed tooltip reads "this second, as received by
   this client". Lines start mid-chart when history is shorter than the
   window; a null point is inserted across disconnect gaps so no line is
   drawn over them.
4. **Loudest topics**: header "Loudest topics (this client's
   subscriptions)"; "(collecting)" suffix until the selected window has
   fully elapsed since window-open. Table: topic, msg/s, bytes/s, share
   bar; top 6 over the selected range. Topic names middle-ellipsise
   (first segment + last two segments kept, full topic in a tooltip); at
   narrow widths the share bar drops first, then bytes/s. Overflow is a
   footer line, never a row: "N+ more topics, X msg/s" ("+" because the
   per-second other-bucket makes the distinct count a lower bound; the
   msg/s sum is exact). No row click in this PR.
5. **Gauges grid**: clients, subscriptions, retained, bytes/s in/out,
   store size, fan-out, avg msg size, custom mapping tiles, observed
   tiles, "+" cell last. Tile upgrades: delta-vs-window arrow in the
   header, shown only when |delta| >= 2% (no ambient flicker); min/max
   and exact values in a hover panel owned by StatTile (the v1 outer
   Tooltip wrapper on observed tiles is removed — one hover surface per
   tile, hover and focus-visible both trigger it; the panel text names
   the window). No min/max footer line, no endpoint dot, no alert tile
   state (drops state lives in the health chip only). Sparklines stay
   currentColor primary.
6. **Facts row**: one line: broker/version, uptime, sessions with word
   labels ("17 live, 6 offline, 2 expired"), avg msg size.
7. **Raw $SYS browser**: collapsed bar unchanged. Expanded view gains a
   derived rate column for counter-like topics (monotonicity heuristic:
   3+ consecutive non-decreasing numeric observations).

## Health rules

Module `health.ts`, evaluated on the 1 s tick:
`(samples, prevState, now) -> {state, since}` per chip. Hysteresis: a
state downgrades only after its condition has been clear for
`max(30 s, learnedInterval)`; hysteresis timestamps live in store state
and are cleared by `resetData()`.

Cadence-robust trend semantics (identical for every chip):

- effective window = `max(ruleWindow, 3 x learnedInterval)`
- "rising" requires >= 3 samples (or rate deltas) inside the effective
  window, all increasing, AND newest sample age <= 2x learnedInterval;
  with fewer than 3 samples the trend clause is false (state falls back
  to the non-trend column, never "hold previous")
- absence of a new sample means "value held flat" (mosquitto republishes
  only changed values; silence is signal, not missing data)
- a chip renders nothing until it has a sample. One gauge sample suffices
  (change-only republishers never re-emit a permanently-zero gauge, so a
  two-sample gate would hide the drops and backlog chips on a healthy
  mosquitto forever); cumulative sources are still protected because their
  first sample is a rate, which needs two raw counter readings

| Chip | Source (first with data) | ok | attention | problem |
| --- | --- | --- | --- | --- |
| Drops | `load/publish/dropped/1min` (scale 1/60); else rate derived from the cumulative candidates listed in the registry table | rate 0 | rate > 0, not rising | rate rising (ruleWindow 60 s), OR rate > 5% of inbound rate (guarded by the derived-rate rules; never fires on inbound < 1 msg/s) |
| Delivery backlog | `packet/out/count` (gauge per mosquitto-8: "current number of packets queued"; a registry fixture from an idle broker asserts plateau behaviour before the chip may bind) | not rising | rising (ruleWindow 60 s) | rising (ruleWindow 120 s) |
| Heap | `heap/current` + `heap/maximum` | plain always, no state dot. "8.2M (peak 9.1M)". `heap/maximum` is a high-watermark, not capacity | — | — |
| Store | `store/messages/count` + `bytes` | not rising | rising (ruleWindow 120 s) | — (never red) |
| Churn | `load/sockets/1min` / `load/connections/1min` (scale 1/60) | plain always, informational | — | — |

## Learned $SYS interval

One EMA shared by the pill, chip staleness, and the hero sparse-note.
Mosquitto publishes bursts, so raw gaps would converge to ~0: arrivals
within the same wall second collapse to one burst; the EMA runs on burst
gaps, floored at 2 s, seeded at 10 s until two burst gaps exist. Gaps
spanning a disconnected period are excluded (bracket with a
was-disconnected flag off the existing connection events).

## Data: per-broker signal availability (researched July 2026)

| Broker | $SYS root | Interval | What v2 gets |
| --- | --- | --- | --- |
| Mosquitto 2.x | `$SYS/broker/` | 10 s, retained, change-only republish | Everything incl. drops + load averages, backlog, heap (compile-opt), store, sessions, churn |
| EMQX 4.x/5.x | `$SYS/brokers/<node>/` | 1 min, not retained, localhost-only ACL default | Drops counter, clients/subs gauges. No backlog/heap/load-avgs. 4.x dotted vs 5.x slashed `stats/*` leaves; both spellings registered. Remote sessions usually see nothing (ACL) → capability notice |
| VerneMQ | `$SYS/<node>/` (node unpredictable → `+` wildcard) | 20 s | Counters incl. queue drops, vm_memory family, retained |
| Mochi-MQTT | `$SYS/broker/` | 1 s, retained | Non-standard leaves (`messages/dropped`, `messages/inflight`, `retained`, `subscriptions`). `system/memory` is process memory — NOT bound to the heap chip |
| FlashMQ / RSMB / CloudMQTT | `$SYS/broker/` | ~10 s | Mosquitto-style subset |
| Aedes + aedes-stats | `$SYS/<random-id>/` | 1 s | clients, heap, uptime via `+` wildcards (leaf spellings verified against aedes-stats source during implementation) |
| NanoMQ | events only | — | Treated as no-$SYS |
| HiveMQ (all), RabbitMQ, BifroMQ, Moquette, AWS IoT, Azure Event Grid, HiveMQ Cloud, EMQX Cloud Serverless, flespi | none | — | Capability notice + observed-only page. Rejected and silent-empty subscribes resolve to the same UI state |

Candidate ordering: exact family paths precede `+` wildcards. Registry
tests: full mosquitto fixture binds every chip to its exact candidate;
aedes-only fixture binds via wildcards; no cross-family mislabel; idle
plateau fixture for `packet/out/count`.

### Registry changes (`sys-metrics.ts`)

Two new flags on metric definitions — they do not coincide:
- `hidden: true` — no gauge tile; value and samples still tracked and
  exposed to the view via a new state field `metricByKey`
- `overrideTarget: false` — excluded from the mapping editor's override
  Select (`MetricMappingEditor` filter changes from `!computed` to an
  explicit allowlist)

Reclassified v1 builtins: `msg_rate_in/out`, `bytes_rate_in/out` become
`hidden` (their samples feed the hero; overriding one redirects the hero
series — intended and documented), `bytes_rate_*` keep gauge tiles;
`uptime`, `version` become `hidden` (feed the facts row). All stay
override targets.

New builtin metrics (all `hidden`, chip/facts/legend consumers):

| id | candidates | kind | scale |
| --- | --- | --- | --- |
| `msgs_dropped` | `$SYS/broker/load/publish/dropped/1min`; `$SYS/broker/mqtt/publish/dropped`*; `$SYS/broker/publish/messages/dropped`*; `$SYS/broker/messages/publish/dropped`*; `$SYS/broker/messages/dropped`*; `$SYS/brokers/+/metrics/messages/dropped`* | gauge; * cumulative | 1/60 on the load candidate |
| `delivery_backlog` | `$SYS/broker/packet/out/count` | gauge | — |
| `heap_current` | `$SYS/broker/heap/current`; `$SYS/+/memory/heap/current` | gauge | — |
| `heap_max` | `$SYS/broker/heap/maximum`; `$SYS/+/memory/heap/maximum` | gauge | — |
| `store_msgs` | `$SYS/broker/store/messages/count`; `$SYS/broker/messages/stored` | gauge | — |
| `store_bytes` | `$SYS/broker/store/messages/bytes` | gauge | — |
| `clients_disconnected` | `$SYS/broker/clients/disconnected` | gauge | — |
| `clients_expired` | `$SYS/broker/clients/expired` | gauge | — |
| `sockets_1min` | `$SYS/broker/load/sockets/1min`; `$SYS/broker/load/connections/1min` | gauge | 1/60 |
| `msg_rate_in_5min` / `_15min`, `msg_rate_out_5min` / `_15min` | `$SYS/broker/load/messages/{received,sent}/{5min,15min}` | gauge | 1/60 |
| `messages_received_total` / `messages_sent_total` | `$SYS/broker/messages/received|sent`; `$SYS/brokers/+/metrics/messages/received|sent` | cumulative | — |

The `*_total` pair feeds fan-out ratio and avg msg size. Derived-rate
guards: a ratio renders "no data" unless both deltas are positive, both
samples span the same interval (timestamps within one learned interval),
and the denominator rate >= 1 msg/s. Counter reset (negative delta)
invalidates that interval for ratios.

## Store additions (`broker-status-store.ts`)

- **Per-topic engine** (loudest topics), O(1) per message:
  - Current-interval maps `curCount/curBytes: Map<topic, number>`;
    admission-only cap: at 512 distinct topics, absent topics increment
    `otherCount/otherBytes` scalars. No eviction, no scans, no per-entry
    objects in the batch path. Buckets are tick-interval, not exact wall
    seconds (a 300 ms batch spanning a boundary lands in the open
    interval) — fine at display grain, comment it.
  - On the 1 s tick: O(512 x 16) partial-select of top 16, push frozen
    record into a 900-deep ring (dedupe by sec), fresh Maps.
  - Top-6 display: merge ring records over the selected window on the
    tick (15 m worst case: 14,400 map ops ~1-2 ms, on the tick, never
    the batch path), cache on the store; `buildState` reuses the cache.
  - Memory: the ring can hold ~14,400 entry objects and non-interned
    topic strings, ~1-2 MB worst case — accepted, documented. No string
    interning (an interning map is unbounded under adversarial
    cardinality).
  - Known bias: a topic never in any per-second top-16 undercounts;
    invisible at top-6 grain.
- **Observed instantaneous series** (hero): on each tick push the rate
  of bucket `sec(now) - 2` (fully settled: batches arrive up to ~300 ms
  late), dedupe by sec, backfill any skipped sec from the 61-bucket ring,
  skip the partial first second after window-open. Cap 900. Tiles keep
  the 60 s trailing average (unchanged, documented).
- **Sample buffers**: cap 300 → 900. `Sparkline` decimates to <= 150
  points via min-max bucketing **by array index** (sidesteps the
  degenerate same-t case), pairs emitted in original order, true last
  sample always emitted.
- **Health**: `health.ts` rules above, evaluated on tick; hysteresis
  timestamps in store state.
- **Interval EMA**: burst-collapsed, as specified above.
- **`setRange(minutes)`**: drives hero window + loudest-topics merge.
- **resetData() clears additionally**: per-topic maps + ring + top
  cache, hidden cumulative baselines, interval EMA, raw-browser
  prev-values, health hysteresis state, observed instantaneous series.
- **Raw browser rates**: `latestByTopic` entries gain
  `prevValue`/`prevTimeMs` (helper in `raw-browser.ts`).
- Disconnect: ticker already stops; chips, loudest and hero freeze with
  the existing "Values frozen" banner — consistent, documented.

## Hero chart implementation

- New pure module `hero-chart-option.ts` + unit test:
  `{series: {id, label, points, dashed, emphasis}[], windowMinutes, now,
  theme} -> EChartsOption`. Not built on `buildChartOption` (coupled to
  message history). Colours: export `CHROME_COLORS` from
  `chart-option.ts` (axis/tooltip chrome; its test pins values) and take
  series colours from `CHART_PALETTE` in `chart-series-store.ts` — both
  named, no palette fork.
- `TopicChart.svelte` lifecycle verbatim: init on mount, ResizeObserver
  resize, dispose on destroy, 1 Hz slide, `$theme` re-render,
  `replaceMerge: ["series"]` with stable ids ("in"/"out"/"observed"),
  x-axis min/max always emitted. `animation: false`, height 160 px.
- Stories inject fixed `now` + static series (deterministic
  test-storybook).

## Performance bar (extended)

- Batch handler adds one map get + add per message, admission-capped.
  Store writes stay coalesced (one per batch + one per tick).
- Perf test: timed flood case grows to ~1,100 batches (proportional time
  budget ~5 s) so the 900 sparkline cap is actually exceeded and
  asserted; per-topic engine runs under the same flood (~9.4k distinct
  topics exercises the 512 admission cap); 5 ms/batch bar holds. A
  separate fake-timer test fills and wraps the 900-deep per-topic ring
  with near-empty batches (cheap), asserting bounded state.
- Hero: setOption at most 1 Hz.

## Files to touch (complete)

New: `health.ts` + test, `hero-chart-option.ts` + test,
`HeroChart`, `TimeRangeSelector`, `HealthStrip` + `HealthChip`,
`LoudestTopics`, `FactsRow` (each .svelte + .spec.json + .stories).
Updated: `broker-status-store.ts` + both test files, `sys-metrics.ts` +
test, `StatTile` (arrow, hover panel; spec/story matrix),
`Sparkline` (decimation), `BrokerStatusView` (layout, scroll, raw rate
column, remove observed-tile Tooltip wrapper), `raw-browser.ts`,
`BrokerStatusWindow.svelte` + spec + story (pill, selector, scroll
wrapper), `MetricMappingEditor.svelte` (override Select allowlist),
`chart-option.ts` + test (export), `frontend/src/stories/fixtures.ts`
(MockBrokerState truth-up: new fields, hidden tiles removed from mock
grids, fixtures for the new components), `component-index.json`
(regenerated). Estimated ~40 files, +3,000-3,600 / -400 lines.

## Commit staging (single PR, three reviewable commits)

1. **Store engine**: registry flags + new entries (data only — the
   hidden filter is NOT applied yet, so the intermediate app still shows
   v1 tiles), per-topic engine, observed series, interval EMA, health
   module, `setRange`, all store/registry/health tests, perf-test
   changes. App fully functional at this commit.
2. **Hero chart + selector**: `hero-chart-option.ts`, `CHROME_COLORS`
   export, `HeroChart`, `TimeRangeSelector`, specs + stories. Components
   land unused; ds:validate and test-storybook pass standalone.
3. **Surfaces + wiring**: health strip, loudest topics, facts row,
   StatTile/Sparkline upgrades, view layout + scroll + raw rate column,
   shell header, editor allowlist, hidden-filter flip, fixtures
   truth-up, component-index.

Gate before PR: `go build ./... && go vet ./...`, `just test`,
`pnpm check`, `pnpm test:run`, `pnpm build`, `pnpm ds:validate`,
`pnpm test-storybook`, `/perf-check` (message handling touched), and an
adversarial code review at the top session tier.

## Decisions log (cycles 1 and 2)

Cycle 1: "session" range cut (buffer honesty); load-trend row cut
(restated the hero's inputs; 5m/15m live in legend tooltips); CONNACK
caps cut (backend touch); NanoMQ churn cut; heap chip never colours;
drops red requires trend or relative threshold; hysteresis everywhere;
dot shape + text qualifier (colour never the only channel); loudest
overflow is a footer line; per-second top-K ring replaced the
fold-smallest design (O(512)/message worst case, double-counted
re-entrants); layout reordered by universality; capability notice
replaces silent hiding; tile ornament halved; facts row word labels;
`packet/out/count` verified against mosquitto-8 after challenge; single
PR (owner constraint) with staged commits.

Cycle 2: em dash removed from specified copy (docs/WRITING_STYLE.md hard
rule) and units unified to msg/s; range selector fully decoupled from
$SYS cadence (client-side loudest topics must not be crippled on EMQX —
only the broker series go sparse); health rules respecified in samples
with `max(fixed, 3x interval)` effective windows, held-flat semantics
for change-only republishers, minimum-sample rendering, and staleness
greying for chips; capability notice deduplicated against the v1 empty
card and reworded (ACL-blocked brokers do publish; the client just
cannot see it); custom HTML legend replaces the ECharts legend (tabular
nums, no reflow jitter, no click-to-hide trap); fold arithmetic fixed
(hero 160 px, top 6 rows, sticky strip); alert-tile clause deleted (one
signal, one place); endpoint dot cut and delta arrow noise-gated;
interval EMA burst-collapsed with disconnect bracketing; observed series
reads `sec-2` with dedupe/backfill; `hidden` split from `overrideTarget`;
perf-test strategy corrected (1,100-batch timed flood + separate
fake-timer ring test); 5m/15min load topics added as hidden entries;
staging amended so every intermediate commit is fully functional.
