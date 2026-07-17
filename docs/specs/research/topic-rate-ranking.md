# Topic rate ranking ("what's flooding my broker") — build spec

Branch: `feat/topic-rate-ranking` → PR into `develop`.
Status: draft for maintainer review.

## What and why

A live, sortable ranking of topics by message rate and byte rate, with
subtree aggregation. Answers the question every broker debugger asks
first: "where is all this traffic coming from?"

Evidence: MQTT Explorer issue #210 asks for exactly this ("pie chart of
topics to see what's flooding the broker"); the broker-side equivalents
(EMQX dashboard topic metrics) need broker admin access a client user
often lacks. No desktop client ships it. We already compute per-node
EWMA message rates in the topic graph branch (PR #76), so most of the
maths exists.

## Wireframe

A "Top topics" section in the existing Broker Status window (it is the
natural "broker health" surface and already has a store + perf-tested
event pipeline):

```
┌─ Broker status ──────────────────────────────────────────────────┐
│ [$SYS metrics as today...]                                       │
├─ Top topics ────────────────── window: [10s ▾] ── by: [msg/s ▾] ─┤
│ topic / subtree                    msg/s   bytes/s   % of total  │
│ ▸ factory/robots/#  (subtree)      1240    310 KB    62% ████▌   │
│   factory/robots/r7/pose            410    102 KB    21% █▌      │
│   factory/robots/r2/pose            395     99 KB    20% █▌      │
│ ▸ sensors/#  (subtree)              610     88 KB    31% ██▎     │
│   test/flood                         95     12 KB     5% ▎       │
│                                       [pause] [export CSV]       │
└──────────────────────────────────────────────────────────────────┘
```

- Rows are the top N (default 20) leaf topics; subtree rows aggregate
  children and expand/collapse. Toggle: leaves only / subtrees.
- Sort by msg/s, bytes/s, or total count in window. Bars = share of
  total observed traffic.
- Click a row → select that topic in the main window (existing
  topic-selection event), so investigation continues in the tree.
- Pause freezes the ranking for reading; export CSV dumps the current
  table.

## Implementation sketch

### Rate accounting (backend)

- Extend the per-connection stats path (`backend/mqtt/stats`) with a
  per-topic counter map: message count + byte count per interval
  bucket. Windowed rates (10s/60s/5m selectable) rather than EWMA:
  windows are easier to explain in a ranking UI, and export cleanly.
  Reuse the EWMA util from PR #76 only if it falls out for free.
- Cardinality guard: cap tracked topics (e.g. 10k) with an LRU on the
  counter map; the ranking only ever displays top N, so evicting cold
  topics is safe. This protects the 2×2000 msg/s bar — counting is one
  map increment per message.
- Aggregation to subtrees happens frontend-side from the leaf table
  (N is small after top-N cut... but %-of-total must be computed
  backend-side against the full count, not the top-N slice).

### Events / frontend

- Piggyback the broker-status event cadence: snapshot of top-N +
  totals every refresh tick (store pattern already perf-tested in
  `broker-status-store.perf.test.ts`).
- New `TopTopicsPanel` component in `BrokerStatusWindow/components/`
  with colocated `.spec.json` + story (`pnpm ds:validate`).

### Gates

- `/perf-check` mandatory (touches the message hot path).
- Unit tests for windowing + LRU eviction; story covers empty state
  ("no traffic observed yet").

## Scope cuts (v1)

- No pie chart — the sorted bar table carries more information; a
  chart can come later if wanted.
- No historical rate timeline per topic (the existing per-topic Chart
  tab already covers a single topic over time).
- Ranking is per connection, not merged across connections.

## Website

On merge, add an entry to `docs/WEBSITE_UPDATES.md`: features list +
broker status page section. Copy angle: find what is flooding your
broker without dashboard admin access.

## Open questions

1. Broker Status window vs a tab in the main data panel? Status window
   keeps the hot-path UI untouched, but is one window away. Suggest
   status window v1; promote later if usage warrants.
2. Should retained-message refreshes count toward rates? Suggest yes
   (they are broker traffic), with the retained marker available later
   if it confuses.
