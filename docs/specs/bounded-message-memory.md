# Bounded message memory + opt-in durable history — Spec

Branch: `fix/bounded-message-memory` → PR into `develop`.

## Problem

Each connection's `backend/mqtt/history.go` holds
`history map[string][]MqttMessage`, append-only, never capped, surviving
disconnect/reconnect. Subscribed long-term → unbounded RAM growth. (Frontend
tree is already latest-per-topic; the only unbounded frontend growth is the
selected-topic timeline + an undisposed `Events.On` listener.)

### What we can lean on (already decoupled from history)

- All-time counts & messages/sec are running integers in `ConnectionStats`,
  not `len(history)`. Bounding history won't break them.
- Per-topic count badges are a frontend tally off the live event stream.
- Live "latest per topic" comes from the 300ms event batch, not history reads.
- Messages already pass through a `MessageBuffer` drained every 300ms — a
  ready batch boundary for DB writes.

So the only consumers of full per-topic history are the selected-topic
**timeline** and **export** — a small blast radius.

## Decisions (locked with user)

1. **Two limits, two purposes:**
   - **Memory budget (MB)** — always on; bounds in-RAM retention; fixes the
     leak whether or not recording is enabled.
   - **Disk budget (GB, default 1 GB, configurable to any size)** — bounds the
     opt-in durable store.
2. **Disk recording is opt-in**, surfaced via a **first-run popup** on the
   first launch after this update.
3. **Substantial back-scroll** via **windowed/virtualized** timeline: load in
   windows (e.g. 5,000), user pages older/newer windows.
4. **Required user choice** — the first-run popup makes them choose
   (record to disk on/off + disk budget).
5. Adversarial DB verification (indexes, migration safety, query plans,
   write/lock interactions) as a final phase.

## Architecture

### Tier 1 — Bounded in-RAM store (always; the actual leak fix)

Replace the unbounded per-connection map with a **bounded store** governed by
the memory budget:

- **Latest-per-topic** map kept always (tiny, bounded by topic count) — feeds
  the live tree (already how the frontend works).
- **Recent ring** of full `MqttMessage`s, evicting **oldest globally** when the
  estimated retained bytes exceed the memory budget. Byte estimate =
  Σ(payload len + topic len + fixed per-message overhead). Maintain a running
  total so eviction is O(1) amortised.
- Eviction holds `MessageHistory.mutex` (the existing single writer).
- Counts/stats untouched (stay all-time).

This alone makes RAM predictable. With recording **off**, selecting a topic
shows whatever of its history is still in the RAM window (bounded, ephemeral —
like today but capped).

Default memory budget: **512 MB** (settings-adjustable; can be increased).

### Tier 2 — Opt-in durable history on disk

When recording is enabled:

**New table `received_messages`** (modeled on `PublishHistory`, which already
persists full messages + v5 props):

```
id              integer PK AUTOINCREMENT   -- insertion order == time order; keyset paging
connection_id   integer                    -- FK (app-enforced, like siblings)
topic           text
payload         blob                        -- store raw bytes (blob, not text) to avoid utf8 bloat
qo_s            integer
retain          numeric
encoding        text
format          text
user_properties text                        -- JSON, nullable
header_*        ...                         -- same nullable v5 header columns as publish_histories
received_at     datetime
```

Indexes:
- `received_messages_conn_topic_id` on `(connection_id, topic, id)` — paged
  per-topic lookup (the timeline query) + keyset pagination by `id`.
- `received_messages_conn_id` on `(connection_id, id)` — global ordering &
  prune-oldest scans.

**Writes — batched, never per-message:** hook the existing 300ms
`MessageBuffer` drain. Each drain writes its batch in **one transaction**
(`CREATE`-many / `CreateInBatches`). No per-message fsync.

**SQLite tuning (new):**
- `journal_mode = WAL` + `synchronous = NORMAL` — concurrent read-during-write
  and far better write throughput than today's rollback-journal + FULL.
- Keep `busy_timeout = 5000`.
- `auto_vacuum` strategy for reclaiming pruned space — **flagged for the
  adversarial phase** (changing auto_vacuum on an existing DB needs a VACUUM;
  alternative: periodic `VACUUM`/`incremental_vacuum` or accept file
  high-water-mark). Decide there.

**Disk budget enforcement (prune oldest):**
- Track size via `PRAGMA page_count × page_size`.
- After every Nth batch (or every few seconds), if size > budget, DELETE the
  oldest rows (`ORDER BY id ASC LIMIT chunk`) until comfortably under, in
  bounded chunks to avoid long write locks. Prune **oldest globally** (the
  budget is the file); per-connection fairness noted as a possible refinement.
- Reclaim space per the auto_vacuum decision above.

**Lookup / paging (the timeline):**
- Window size 5,000 (tunable). Newest window:
  `WHERE connection_id=? AND topic=? ORDER BY id DESC LIMIT 5000`.
- Older windows via **keyset pagination** (`AND id < ?lastSeenId`) — O(log n)
  with the composite index, not OFFSET scans.
- New App methods: `GetReceivedMessageWindow(connId, topic, beforeId?, limit)`
  + a count/extent method for the window UI.

### Mode interaction (kept simple)

- **Recording OFF:** selected-topic history source = in-RAM bounded window.
- **Recording ON:** selected-topic history source = disk (paged windows); RAM
  still holds latest-per-topic + the live newest window.
- The in-RAM bounded store exists in both modes; it's the live/newest data and
  the always-on leak guard.

### Settings & first-run

- New settings (key-value `settings` table, or extend `Global`):
  `recording_enabled bool`, `disk_budget_bytes int`, `memory_budget_bytes int`.
- **First-run popup** (first launch post-update): configures **both** the
  **memory budget** (default 512 MB) and **durable disk recording** (enable +
  disk budget, default 1 GB), or "not now". Re-accessible from settings.
  Records a "seen" flag so it shows once.
- Settings UI: memory budget, recording toggle, disk budget, "clear recorded
  history", current DB size readout.

### Frontend changes

- **Windowed timeline:** `selected-topic-store` loads a window (not the whole
  history); prev/next-window controls; live appends to the newest window only.
  vis-timeline already virtualizes rendering; we virtualize the *data*.
- **Fix the `Events.On` listener leak** in `mqtt-data.ts` and
  `selected-topic-store.ts` (capture + call the unsubscribe on teardown).
- Settings + first-run popup components.
- Counts/stats/tree/search unchanged.

## Constraints to preserve (from exploration)

- Counts & messages/sec stay all-time, independent of retention.
- Per-topic count badges (frontend tally) keep working.
- Live latest-per-topic tree display unaffected.
- Selected-topic next/prev navigation + compare-with-previous keep working
  within/across windows.
- Arrival ordering; retained flag preserved on kept messages.
- Export: with recording on → exports from disk (full bounded history); off →
  exports the RAM window (flag the semantic).
- New table needs a `DeleteConnection` cascade line (FKs are app-enforced).

## Build phases

1. **In-RAM bounding (leak fix)** — ring + byte budget + eviction; unit tests.
   Ships value immediately, low risk.
2. **DB foundation** — WAL/synchronous in `db.go`; migration for
   `received_messages` + indexes; models; settings storage; bindings.
3. **Batched persistence** — write the 300ms batch in one tx behind the
   recording flag.
4. **Disk budget pruning** — size check + prune-oldest + space reclaim.
5. **Paged lookup + App methods** — keyset window queries; bindings.
6. **Frontend** — windowed timeline + paging UI; listener-leak fix; settings;
   first-run popup.
7. **Adversarial DB verification** — indexes/query plans (`EXPLAIN QUERY
   PLAN`), migration idempotency + auto_vacuum interaction, write throughput
   under load, prune lock behavior, WAL checkpoint behavior.

Each phase keeps the app building + the suite green.
