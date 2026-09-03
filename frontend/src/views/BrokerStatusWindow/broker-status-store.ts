// Data store for the detached Broker Status window. Owns the live $SYS metric
// browser, the curated stat-tile values + sparklines, and the client-side
// observed message/byte rates. It is fed by the same Wails batch event stream
// as the main window, so it must stay cheap under heavy broker load — see the
// "Performance (hard requirements)" section of docs/broker-status-spec.md.
//
// Performance contract honoured here:
//   - Observed-rate counting is *counters-only*: the all-messages feed bumps
//     integer counts/bytes in a fixed 61-bucket ring (one bucket per wall
//     second). No per-message object is ever allocated for rate tracking.
//   - $SYS filtering is a cheap `startsWith("$SYS/")` plus a Set lookup for
//     custom mapping topics; only those payloads are base64-decoded.
//   - Svelte store writes are coalesced: at most one `set` per incoming batch
//     event (~300 ms cadence) and one per 1 s ticker tick — never per message.
//   - Sparkline buffers are capped and trimmed in place.
//   - Ranges longer than 15 m are served by fixed-size minute rollups (a
//     1,440-slot topic ring and one-minute averages of the hero series), so a
//     24 h range costs the same memory as a 1 m one. See long-series.ts.

import { get, writable } from "svelte/store";
import { Events } from "@wailsio/runtime";
import type * as events from "bindings/mqtt-viewer/events/models";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import {
  GetSysMessageHistory,
  GetMessageHistory,
  GetSysMetricMappingsByConnectionId,
} from "bindings/mqtt-viewer/backend/app/app";
import { base64ToUtf8 } from "@/components/CodeEditor/codec";
import {
  mergeMappings,
  parseSample,
  selectCandidate,
  formatMetricValue,
  humanizeDuration,
  type MetricTile,
  type SelectedCandidate,
  type SysMetricMappingRow,
} from "./sys-metrics";
import {
  evaluateHealth,
  type HealthChip,
  type HealthChipId,
  type HealthChipState,
  type HealthMetric,
} from "./health";
import {
  createMinuteSeries,
  stitch,
  type MinuteSeries,
} from "./long-series";
import { createHeavyHitters, lowerBound } from "./heavy-hitters";

/**
 * Max sparkline points retained per tile; older points are trimmed in place.
 * v2: raised 300 → 900 so the 15 m tile sparklines (and the observed hero
 * series) hold a full window at 1 Hz.
 */
export const SPARKLINE_CAP = 900;
/** Ring size for the observed-rate counters: 60 s window + 1 spare bucket. */
export const OBSERVED_BUCKETS = 61;
/** Sliding window (seconds) the observed msgs/s and bytes/s are averaged over. */
export const OBSERVED_WINDOW_SEC = 60;
/** Ticker cadence for recomputing the observed rates. */
export const TICKER_MS = 1000;

export const OBSERVED_MSG_KEY = "observed_msg_rate";
export const OBSERVED_BYTE_KEY = "observed_byte_rate";
/** Derived tiles filled on the tick from the hidden cumulative message totals. */
export const FAN_OUT_KEY = "fan_out";
export const AVG_MSG_SIZE_KEY = "avg_msg_size";

// --- Per-topic ("loudest topics") engine constants ---------------------------
/**
 * Space-Saving counters held for the open interval (see heavy-hitters.ts).
 * This is what bounds the per-topic engine now: no admission cap, no unbounded
 * map, and ranking no longer depends on which topic happened to arrive first.
 * Wide enough that ordinary brokers never evict at all, so their counts are
 * exact; past that, a counter over-states by at most the interval's total / k
 * and the reading corrects it back out.
 */
export const TOPIC_SUMMARY_K = 512;
/**
 * Counters frozen into each ring record. The record also carries the
 * interval's exact totals, so the topics dropped here are still accounted for
 * in "other topics", just not named. Chosen by count, ties broken by topic
 * name so the same topics are captured second after second (an arrival-order
 * tie-break would sample a flat tree differently every second and under-report
 * every one of them).
 */
export const TOPIC_CAPTURE_K = 32;
/**
 * Distinct topics a window merge will track. Records are folded newest first,
 * so past the cap it is the oldest records that stop contributing new names.
 * Only the top LOUDEST_ROWS are shown and "other" comes from the exact totals,
 * so this bounds the merge without touching either number's honesty.
 */
export const TOPIC_MERGE_CAP = 4096;
/** Depth of the per-second ring: 900 s = 15 m at 1 Hz. */
export const TOPIC_RING_CAP = 900;
/**
 * Depth of the per-minute ring the second-grain records roll up into: 1,440
 * minutes = one day, which is the longest selectable range. Fixed cost: it
 * holds the same 1,440 records whether the selected range is 1 m or 24 h.
 */
export const TOPIC_MINUTE_RING_CAP = 1440;
/** Rows shown in the loudest-topics table. */
export const LOUDEST_ROWS = 6;

/**
 * Cap on distinct topics held in the raw-browser map. Brokers that publish a
 * $SYS subtree per connected client (EMQX) would otherwise grow `latest`
 * without bound on a busy broker. Past the cap, new topics are dropped (the
 * ones already bound to tiles keep updating) and a single warning is logged.
 */
export const LATEST_TOPIC_CAP = 2000;

/**
 * Minimum settle time after a (re)connect before trend clauses and tile deltas
 * may use samples again. A broker restart republishes its whole retained store,
 * which looks exactly like a rising trend; the effective floor is the larger of
 * this and three learned $SYS intervals.
 *
 * Set to the longest health rule window (the store chip's 120 s) so no rule can
 * reach its verdict on a window that is still mostly repopulation. It is a
 * heuristic, not a guarantee: a broker whose store takes longer than this to
 * refill will still raise the chip once.
 */
export const TREND_SETTLE_MIN_MS = 120_000;

// --- Time-range constants ----------------------------------------------------
export const DEFAULT_RANGE_MINUTES = 5;
/** Shortest selectable range (1 s), so a range can never divide by zero. */
export const MIN_RANGE_MINUTES = 1 / 60;
/** Longest selectable range: one day, the span the minute rings retain. */
export const MAX_RANGE_MINUTES = 1440;
/**
 * Span the second-grain buffers cover (the 900-deep topic ring and the 900
 * settled seconds of observed samples). Ranges up to this read straight from
 * them; longer ranges read the minute rollups, stitched to the second-grain
 * tail so the live edge stays live.
 */
export const RAW_RANGE_MINUTES = 15;
/**
 * Re-merge interval for the loudest table on a long range. At 24 h a merge
 * walks both rings, which is far more work than the 1 Hz tick needs to do for
 * a table whose numbers move slowly. Short ranges keep merging every tick.
 */
export const LONG_MERGE_INTERVAL_MS = 5_000;

/**
 * Holds a range inside what the buffers can honestly serve. A range longer
 * than a day would draw a line the minute rings never retained.
 */
export const clampRange = (minutes: number): number => {
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_RANGE_MINUTES;
  return Math.min(Math.max(minutes, MIN_RANGE_MINUTES), MAX_RANGE_MINUTES);
};

// --- Learned $SYS interval (burst-collapsed EMA) constants -------------------
/** Seed interval (s) until two burst gaps have been observed. */
export const INTERVAL_SEED_SEC = 10;
/** Floor (s) on a single burst gap (mosquitto bursts would converge to ~0). */
export const INTERVAL_FLOOR_SEC = 2;
/** EMA smoothing factor on burst gaps. */
export const INTERVAL_ALPHA = 0.3;

/** One sparkline point: `t` = ms epoch, `v` = plotted value. */
export interface SparklineSample {
  t: number;
  v: number;
}

/** Newest decoded value seen for a browsed topic ($SYS/* or a mapped topic). */
export interface LatestTopicEntry {
  /** utf8-decoded payload. */
  value: string;
  timeMs: number;
}

/**
 * A tile as the view renders it. `value` is the raw number (rate for
 * cumulative/observed tiles, seconds for duration tiles); `display` is the
 * ready-to-render string. `valueKind` distinguishes a live number, raw text,
 * and the "no data yet" state so the view can show a subdued placeholder.
 */
export interface BrokerTileView {
  key: string;
  label: string;
  unit?: string;
  tooltip?: string;
  computed: boolean;
  valueKind: "number" | "text" | "empty";
  value: number | null;
  text: string | null;
  /** Formatted, display-ready string. "" when empty. */
  display: string;
  /** True when the value is a duration in seconds (render via humanizeDuration). */
  isDuration: boolean;
  samples: SparklineSample[];
}

/**
 * A metric's live snapshot, exposed for every registry entry — hidden ones
 * included — so the hero, health strip, facts row and derived tiles can read
 * values that no longer have a gauge tile of their own.
 */
export interface MetricSnapshot {
  key: string;
  value: number | null;
  text: string | null;
  isDuration: boolean;
  samples: SparklineSample[];
  /** Newest sample time folded in (for cadence/staleness reasoning). */
  lastTimeMs: number;
  hidden: boolean;
}

/** One row of the loudest-topics table. */
export interface LoudestTopic {
  topic: string;
  msgPerSec: number;
  bytesPerSec: number;
}

/** The loudest-topics view model, recomputed on the tick and cached. */
export interface LoudestState {
  rows: LoudestTopic[];
  /**
   * Distinct topics beyond the shown rows that survived the per-second top-K
   * capture. NOT a usable total: both the per-second top-K and the admission
   * cap discard topics without counting them, so the true figure is unknowable
   * from here. Treated as a boolean "there is unlisted traffic" by the table,
   * which names the exact msg/s instead of a topic count.
   */
  overflowTopics: number;
  /** Exact msg/s not attributed to a shown row (merged tail + other-bucket). */
  overflowMsgPerSec: number;
  /** False until the selected window has fully elapsed since window-open. */
  collecting: boolean;
}

export interface BrokerStatusState {
  /**
   * Visible tiles the gauges grid renders, in display order. v2 marks several
   * builtins `hidden`; in the store-engine commit the visible predicate still
   * keeps the reclassified v1 tiles (`msg_rate_*`, `uptime`, `version`) so the
   * running app is unchanged — the brand-new hidden metrics never appear here
   * (read them from `metricByKey`).
   */
  tiles: BrokerTileView[];
  /** Every metric's snapshot, keyed by registry id — hidden ones included. */
  metricByKey: Map<string, MetricSnapshot>;
  /** Raw browser data: newest decoded value per $SYS/* or mapped topic. */
  latestByTopic: Map<string, LatestTopicEntry>;
  /**
   * Broker connection up/down, driven by the connection's Wails events. The
   * automatic reconnect loop counts as down: an unexpected outage emits
   * `mqttReconnecting`, not `mqttDisconnected`.
   */
  connected: boolean;
  /**
   * True once this store has seen the connection up. Lets the view tell "never
   * connected" apart from "was connected, now frozen".
   */
  everConnected: boolean;
  /**
   * Samples older than this are excluded from trend rules and tile deltas, so
   * a reconnect's retained-store repopulation is not reported as a rising
   * broker. 0 = no floor. May sit in the future during the settle period.
   */
  trendFloorMs: number;
  /** True once any $SYS/* message has been seen (backfill or live). */
  sysEverSeen: boolean;
  /** Epoch ms the window/store opened — the view's 10 s empty-state grace. */
  windowOpenedAt: number;
  /** Selected time range (minutes): drives the hero window + loudest merge. */
  rangeMinutes: number;
  /** Burst-collapsed EMA of the $SYS republish interval (ms), for pill/chips. */
  learnedIntervalMs: number;
  /** Newest $SYS message time (ms), for the header staleness pill. */
  sysLastSeenMs: number;
  /** Per-second client-observed msgs/s (settled), for the hero's third series. */
  observedSeries: SparklineSample[];
  /**
   * Minute-grain hero series, stitched to their live second-grain tail. Set
   * only while the selected range is longer than the second-grain buffers
   * cover (see RAW_RANGE_MINUTES); null otherwise, meaning "read the raw
   * samples". Keyed by "observed", "msg_rate_in" and "msg_rate_out".
   */
  longSeries: Map<string, SparklineSample[]> | null;
  /** Loudest-topics view model (top rows + overflow + collecting flag). */
  loudest: LoudestState;
  /** Evaluated health chips (renderable), in strip order. */
  health: HealthChip[];
}

export type BrokerStatusStore = ReturnType<typeof createBrokerStatusStore>;

// Internal per-tile runtime kept outside the exposed state so the batch/tick
// handlers can mutate it without allocating a new tile object per message.
interface TileRuntime {
  samples: SparklineSample[];
  value: number | null;
  text: string | null;
  isDuration: boolean;
  /** Newest sample time already folded in, to avoid re-sampling retained values. */
  lastTimeMs: number;
  /** Which topic that last sample came from (so a candidate switch re-samples). */
  lastTopic: string;
}

interface ObservedBucket {
  /** Wall-clock second this bucket accounts for; -1 = unused. */
  sec: number;
  count: number;
  bytes: number;
}

/** One topic's captured totals inside a ring record. Corrected, not inflated. */
interface TopicRingEntry {
  topic: string;
  count: number;
  bytes: number;
}

/**
 * A frozen capture: the interval's heavy-hitter counters plus its EXACT totals.
 * Pushed onto the ring by the tick; never mutated after.
 *
 * The totals are counted per message and are never approximate, which is what
 * makes "other topics" exact: it is the window total minus the rows shown,
 * rather than a leftover the summary happened to keep.
 *
 * `secs` is how many wall seconds the record accounts for. Per-second records
 * always carry 1; a minute rollup carries however many of its seconds were
 * actually observed, so a rate divided by the summed `secs` stays true even
 * when a minute was only partly covered.
 */
interface TopicRingRecord {
  sec: number;
  entries: TopicRingEntry[];
  totalCount: number;
  totalBytes: number;
  secs: number;
}

const emptyRuntime = (): TileRuntime => ({
  samples: [],
  value: null,
  text: null,
  isDuration: false,
  lastTimeMs: -1,
  lastTopic: "",
});

/**
 * Which effective tiles render on the gauges grid. v2 (surfaces commit): a plain
 * `!hidden` filter. The reclassified v1 builtins (`msg_rate_*`, `uptime`,
 * `version`) and every brand-new diagnostic/derived metric are `hidden`, so they
 * leave the grid and reach the view through `metricByKey` (hero, facts row,
 * health chips, derived tiles) instead. Custom/override tiles and the observed
 * computed tiles stay visible.
 */
const isVisibleTile = (tile: MetricTile): boolean => !tile.hidden;

export const createBrokerStatusStore = (
  connectionId: number,
  eventSet: events.ConnectionEventsSet,
  opts: { connected?: boolean; rangeMinutes?: number } = {}
) => {
  // Effective tiles + per-tile runtime, keyed by tile.key. Runtime survives a
  // mappings reload for tiles whose key is unchanged (preserving sparklines).
  let effectiveTiles: MetricTile[] = mergeMappings([]);
  let runtime = new Map<string, TileRuntime>();
  for (const t of effectiveTiles) runtime.set(t.key, emptyRuntime());

  // Exact topics from custom/override mappings (may be outside $SYS/). Decoded
  // and browsable alongside $SYS/*.
  let trackedTopics = new Set<string>();

  // Raw-browser data: newest decoded value per browsed topic. Capped at
  // LATEST_TOPIC_CAP distinct topics; `latestCapWarned` keeps the console
  // warning to one per cap event.
  const latest = new Map<string, LatestTopicEntry>();
  let latestCapWarned = false;
  // Bumped whenever `latest` gains a KEY (not on a value update). Candidate
  // selection only depends on the key set, so recomputeTiles re-runs the
  // pattern matching when this changes and reuses the cached winners otherwise.
  let topicSetVersion = 0;
  let selectionVersion = -1;
  const selectionByTile = new Map<string, SelectedCandidate | null>();

  // Last {value,timeMs} per cumulative tile, for deriving a /s rate.
  const cumPrev = new Map<string, { value: number; timeMs: number }>();

  // Observed-rate counters: fixed ring, one bucket per wall second.
  const buckets: ObservedBucket[] = Array.from(
    { length: OBSERVED_BUCKETS },
    () => ({ sec: -1, count: 0, bytes: 0 })
  );

  // Per-second client-observed msgs/s, settled at sec(now)-2. Capped ring array
  // (trimmed in place), consumed by the hero's third series.
  let observedSeries: SparklineSample[] = [];
  // Minute rollups of the three hero series, so a range longer than the
  // second-grain buffers still has a full line to draw. Fixed cost: 1,440
  // closed minutes each, whatever the range.
  const observedMinutes = createMinuteSeries();
  const heroMinutes = new Map<string, MinuteSeries>([
    ["msg_rate_in", createMinuteSeries()],
    ["msg_rate_out", createMinuteSeries()],
  ]);
  // Stitched long series, rebuilt on the tick while the range needs them.
  let longSeriesCache: Map<string, SparklineSample[]> | null = null;
  // Newest settled second already pushed into observedSeries (-1 = none yet).
  let lastObservedSec = -1;

  // --- Per-topic engine (loudest topics) -------------------------------------
  // Current open interval: a bounded heavy-hitter summary plus exact totals.
  // Reset every tick. Buckets are tick-interval, not exact wall seconds — a
  // batch straddling a boundary lands wholly in the open interval, which is
  // fine at display grain.
  const curSummary = createHeavyHitters(TOPIC_SUMMARY_K);
  let curTotalCount = 0;
  let curTotalBytes = 0;
  // Fixed-size ring of frozen per-second records (a plain circular buffer).
  const topicRing: (TopicRingRecord | null)[] = new Array(TOPIC_RING_CAP).fill(
    null
  );
  let topicRingHead = -1; // index of the most recent record
  let topicRingLen = 0; // number of populated records (≤ TOPIC_RING_CAP)
  // Minute rollups of the same records, for ranges beyond the second ring's
  // 15 m. `minuteOpen` accumulates the minute in progress and is only pushed
  // once a later minute starts, so a ring record always covers a whole minute
  // (`secs` says how many of its seconds were observed).
  const topicMinuteRing: (TopicRingRecord | null)[] = new Array(
    TOPIC_MINUTE_RING_CAP
  ).fill(null);
  let topicMinuteHead = -1;
  let topicMinuteLen = 0;
  let minuteOpen: TopicRingRecord | null = null;
  // Cached merge over the selected window, recomputed on the tick so buildState
  // is cheap. Seeded empty.
  let loudestCache: LoudestState = {
    rows: [],
    overflowTopics: 0,
    overflowMsgPerSec: 0,
    collecting: true,
  };

  // --- Learned $SYS interval (burst-collapsed EMA) ---------------------------
  let lastBurstSec = -1; // wall second of the last $SYS burst (-1 = none)
  let intervalEmaSec = INTERVAL_SEED_SEC; // running EMA accumulator
  let intervalBurstGaps = 0; // folded gaps so far
  let learnedIntervalSec = INTERVAL_SEED_SEC; // exposed value (seed until ≥2 gaps)
  // Set when a disconnect breaks the burst sequence; the next burst's gap is
  // excluded so a disconnected span never poisons the EMA.
  let intervalGapBroken = false;

  // --- Health ----------------------------------------------------------------
  // Persisted hysteresis state per chip, passed back into evaluateHealth each
  // tick and cleared by resetData.
  let healthStates = new Map<HealthChipId, HealthChipState>();
  let healthChips: HealthChip[] = [];

  // Selected time range (minutes, may be fractional for a sub-minute custom
  // interval). Drives the hero window + loudest merge.
  let rangeMinutes = clampRange(opts.rangeMinutes ?? DEFAULT_RANGE_MINUTES);
  // Wall time of the last loudest merge, for the long-range throttle.
  let lastMergeMs = 0;

  let sysEverSeen = false;
  let sysLastSeenMs = -1;
  let connected = opts.connected ?? true;
  let everConnected = connected;
  let trendFloorMs = 0;
  const windowOpenedAt = Date.now();
  let openedAt = windowOpenedAt;

  // Bumped whenever the data is reset (history cleared). Async backfills capture
  // it before their awaited fetch and discard the ingest if it changed while the
  // fetch was in flight, so a clear that races a slow history fetch can't
  // resurrect stale, just-cleared history.
  let dataEpoch = 0;

  const buildTile = (tile: MetricTile): BrokerTileView => {
    const rt = runtime.get(tile.key) ?? emptyRuntime();
    let valueKind: BrokerTileView["valueKind"];
    let display: string;
    if (rt.value !== null) {
      valueKind = "number";
      const num = rt.isDuration
        ? humanizeDuration(rt.value)
        : formatMetricValue(rt.value);
      display = tile.unit ? `${num} ${tile.unit}` : num;
    } else if (rt.text !== null) {
      valueKind = "text";
      display = rt.text;
    } else {
      valueKind = "empty";
      display = "";
    }
    return {
      key: tile.key,
      label: tile.label,
      unit: tile.unit,
      tooltip: tile.tooltip,
      computed: tile.computed ?? false,
      valueKind,
      value: rt.value,
      text: rt.text,
      display,
      isDuration: rt.isDuration,
      samples: rt.samples,
    };
  };

  // Every effective tile's snapshot, so hidden values (hero series, chip
  // sources, facts, derived ratios) reach the view without a gauge tile.
  const buildMetricByKey = (): Map<string, MetricSnapshot> => {
    const out = new Map<string, MetricSnapshot>();
    for (const t of effectiveTiles) {
      const rt = runtime.get(t.key) ?? emptyRuntime();
      out.set(t.key, {
        key: t.key,
        value: rt.value,
        text: rt.text,
        isDuration: rt.isDuration,
        samples: rt.samples,
        lastTimeMs: rt.lastTimeMs,
        hidden: t.hidden ?? false,
      });
    }
    return out;
  };

  const buildState = (): BrokerStatusState => ({
    tiles: effectiveTiles.filter(isVisibleTile).map(buildTile),
    metricByKey: buildMetricByKey(),
    latestByTopic: latest,
    connected,
    everConnected,
    trendFloorMs,
    sysEverSeen,
    windowOpenedAt: openedAt,
    rangeMinutes,
    learnedIntervalMs: learnedIntervalSec * 1000,
    sysLastSeenMs,
    observedSeries,
    longSeries: longSeriesCache,
    loudest: loudestCache,
    health: healthChips,
  });

  const { subscribe, set } = writable<BrokerStatusState>(buildState());
  const flush = () => set(buildState());

  // Samples feed the tile's own capped buffer and, for the two hero broker
  // rates, the minute rollup a long range reads from.
  const pushSample = (key: string, rt: TileRuntime, t: number, v: number) => {
    rt.samples.push({ t, v });
    if (rt.samples.length > SPARKLINE_CAP) rt.samples.shift();
    heroMinutes.get(key)?.push(t, v);
  };

  // Recomputes each tile's winning candidate. Pattern matching costs
  // O(tiles × candidates × topics), so it only re-runs when the topic KEY set
  // changed (or the mappings did) — on a broker with thousands of $SYS topics
  // that turns a per-batch scan into a rare one.
  const refreshSelections = () => {
    if (selectionVersion === topicSetVersion) return;
    const topics = Array.from(latest.keys());
    selectionByTile.clear();
    for (const tile of effectiveTiles) {
      if (tile.computed) continue;
      selectionByTile.set(tile.key, selectCandidate(tile, topics));
    }
    selectionVersion = topicSetVersion;
  };

  // Re-evaluates every non-computed tile against the current `latest` topics.
  // Cheap (≈ a dozen tiles); the per-tile timeMs guard makes repeat calls no-op
  // when nothing new arrived, so calling it once per batch is enough.
  const recomputeTiles = () => {
    refreshSelections();
    for (const tile of effectiveTiles) {
      if (tile.computed) continue;
      const rt = runtime.get(tile.key);
      if (!rt) continue;
      const sel = selectionByTile.get(tile.key);
      if (!sel) continue;
      const entry = latest.get(sel.topic);
      if (!entry) continue;
      const topicSwitched = sel.topic !== rt.lastTopic;
      if (!topicSwitched && entry.timeMs <= rt.lastTimeMs) continue;
      // When the winning candidate switches to a different topic, the previous
      // cumulative baseline belongs to the old topic; keeping it would produce a
      // bogus (often huge) delta on the first sample from the new topic. Drop it
      // so the next sample seeds a fresh baseline instead.
      if (topicSwitched) cumPrev.delete(tile.key);
      rt.lastTopic = sel.topic;
      rt.lastTimeMs = entry.timeMs;

      const parsed = parseSample(sel.candidate, entry.value);
      if (parsed.kind === "text") {
        rt.text = parsed.text;
        rt.value = null;
        rt.isDuration = false;
        continue;
      }
      rt.text = null;

      if (sel.candidate.kind === "cumulative") {
        const prev = cumPrev.get(tile.key);
        cumPrev.set(tile.key, { value: parsed.value, timeMs: entry.timeMs });
        if (prev) {
          const dt = (entry.timeMs - prev.timeMs) / 1000;
          let rate = dt > 0 ? (parsed.value - prev.value) / dt : (rt.value ?? 0);
          if (rate < 0) rate = 0; // counter reset (broker restart) → clamp
          rt.value = rate;
          rt.isDuration = false;
          pushSample(tile.key, rt, entry.timeMs, rate);
        }
        // First cumulative sample yields no rate yet: nothing to display.
        continue;
      }

      rt.isDuration = sel.candidate.kind === "duration";
      rt.value = parsed.value;
      pushSample(tile.key, rt, entry.timeMs, parsed.value);
    }
  };

  const addObserved = (timeMs: number, base64Len: number) => {
    const sec = Math.floor(timeMs / 1000);
    const idx = ((sec % OBSERVED_BUCKETS) + OBSERVED_BUCKETS) % OBSERVED_BUCKETS;
    const b = buckets[idx];
    if (b.sec !== sec) {
      b.sec = sec;
      b.count = 0;
      b.bytes = 0;
    }
    b.count += 1;
    // base64 decodes to ~3/4 of its length — close enough, and avoids decoding
    // payloads of topics we don't otherwise track.
    b.bytes += Math.floor((base64Len * 3) / 4);
  };

  const sumObserved = (nowSec: number) => {
    let count = 0;
    let bytes = 0;
    for (const b of buckets) {
      if (b.sec < 0) continue;
      const age = nowSec - b.sec;
      if (age >= 0 && age < OBSERVED_WINDOW_SEC) {
        count += b.count;
        bytes += b.bytes;
      }
    }
    return { count, bytes };
  };

  // Message count in the observed ring for an exact wall second (0 if that
  // second's bucket has since been overwritten — only possible >61 s back).
  const bucketCountForSec = (sec: number): number => {
    const idx = ((sec % OBSERVED_BUCKETS) + OBSERVED_BUCKETS) % OBSERVED_BUCKETS;
    const b = buckets[idx];
    return b.sec === sec ? b.count : 0;
  };

  // Pushes the settled per-second observed msgs/s (sec(now)-2, fully arrived at
  // the ~300 ms batch lag) into observedSeries, backfilling any skipped seconds
  // from the ring and skipping the partial first second after window-open.
  //
  // The cursor is dropped to -1 whenever the connection goes down, so a resumed
  // series starts at "now" instead of inventing a zero for every second of the
  // outage. The catch-up is clamped anyway: a suspended laptop can wake with
  // hours of skipped seconds, and only the newest SPARKLINE_CAP of them could
  // survive the trim.
  const pushObservedSeries = (nowSec: number) => {
    const target = nowSec - 2;
    if (lastObservedSec < 0) {
      // First tick (or the first after an outage): the current second is
      // partial, so start pushing the second AFTER it. Never backfill before
      // the window opened.
      lastObservedSec = Math.max(
        Math.floor(openedAt / 1000),
        target - 1
      );
    }
    if (target <= lastObservedSec) return;
    const from = Math.max(lastObservedSec + 1, target - SPARKLINE_CAP + 1);
    for (let sec = from; sec <= target; sec++) {
      const v = bucketCountForSec(sec);
      observedSeries.push({ t: sec * 1000, v });
      observedMinutes.push(sec * 1000, v);
    }
    // One splice, not a shift per pushed sample.
    if (observedSeries.length > SPARKLINE_CAP) {
      observedSeries.splice(0, observedSeries.length - SPARKLINE_CAP);
    }
    lastObservedSec = target;
  };

  // --- Per-topic engine ------------------------------------------------------
  // O(1) admission-capped count of one received message. No scans, no per-entry
  // objects beyond the (bounded) map keys.
  const addTopicCount = (topic: string, bytes: number) => {
    curTotalCount += 1;
    curTotalBytes += bytes;
    curSummary.add(topic, bytes);
  };

  // Ranks captured entries the way records store them: loudest first, ties by
  // topic name so the capture is stable second after second.
  const captureTop = (entries: TopicRingEntry[]): TopicRingEntry[] =>
    entries
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
      .slice(0, TOPIC_CAPTURE_K);

  // Folds `add` into `base`: captured topics add up and the exact totals add
  // up. Used when two ticks land in the same wall second, and to roll a
  // minute's seconds into one record.
  const mergeRingRecords = (
    base: TopicRingRecord,
    add: TopicRingRecord
  ): TopicRingRecord => {
    const byTopic = new Map<string, TopicRingEntry>();
    for (const e of [...base.entries, ...add.entries]) {
      const cur = byTopic.get(e.topic);
      if (cur) {
        cur.count += e.count;
        cur.bytes += e.bytes;
      } else {
        byTopic.set(e.topic, { topic: e.topic, count: e.count, bytes: e.bytes });
      }
    }
    return {
      sec: base.sec,
      entries: captureTop(Array.from(byTopic.values())),
      totalCount: base.totalCount + add.totalCount,
      totalBytes: base.totalBytes + add.totalBytes,
      secs: base.secs + add.secs,
    };
  };

  // Freeze the open interval (its counters and its exact totals) into a ring
  // record, then reset it. Deduped by sec: a second tick landing in the same
  // wall second merges into the head record rather than replacing it.
  const rotateTopicInterval = (sec: number) => {
    const record: TopicRingRecord = {
      sec,
      entries: captureTop(
        curSummary.entries().map((e) => ({ topic: e.topic, ...lowerBound(e) }))
      ),
      totalCount: curTotalCount,
      totalBytes: curTotalBytes,
      secs: 1,
    };
    const head = topicRingHead >= 0 ? topicRing[topicRingHead] : null;
    const sameSecond = !!head && head.sec === sec;
    if (sameSecond) {
      topicRing[topicRingHead] = mergeRingRecords(head!, record);
    } else {
      topicRingHead = (topicRingHead + 1) % TOPIC_RING_CAP;
      topicRing[topicRingHead] = record;
      topicRingLen = Math.min(topicRingLen + 1, TOPIC_RING_CAP);
    }
    // A second tick inside the same wall second adds counts but no new second,
    // so it must not inflate the minute's divisor.
    rollUpMinute(sameSecond ? { ...record, secs: 0 } : record);
    curSummary.clear();
    curTotalCount = 0;
    curTotalBytes = 0;
  };

  // Folds a frozen second into the open minute, pushing the previous minute
  // onto the minute ring when the wall minute turns over. The fold keeps the
  // minute's strongest captured topics and its exact totals, exactly as the
  // per-second capture does within a second.
  const rollUpMinute = (record: TopicRingRecord) => {
    const minuteSec = Math.floor(record.sec / 60) * 60;
    if (minuteOpen && minuteOpen.sec !== minuteSec) {
      topicMinuteHead = (topicMinuteHead + 1) % TOPIC_MINUTE_RING_CAP;
      topicMinuteRing[topicMinuteHead] = minuteOpen;
      topicMinuteLen = Math.min(topicMinuteLen + 1, TOPIC_MINUTE_RING_CAP);
      minuteOpen = null;
    }
    if (!minuteOpen) {
      minuteOpen = {
        sec: minuteSec,
        entries: [],
        totalCount: 0,
        totalBytes: 0,
        secs: 0,
      };
    }
    minuteOpen = mergeRingRecords(minuteOpen, record);
  };

  // Merge the last `windowMinutes` of ring records into the top-N loudest
  // topics + an exact overflow rate. Runs on the tick (14,400 map ops worst
  // case at 15 m), never on the batch path.
  const mergeLoudest = (windowMinutes: number, now: number): LoudestState => {
    const windowSec = windowMinutes * 60;
    // Records are pushed newest-first, so the first out-of-window record ends
    // the scan. Without this age gate a ring frozen by an outage keeps feeding
    // "over the last 5m" rates from traffic that stopped long ago.
    const oldestSec = Math.floor(now / 1000) - windowSec;
    // Per-topic totals for the window, bounded by TOPIC_MERGE_CAP, alongside
    // the window's exact totals.
    const merged = new Map<string, TopicRingEntry>();
    let totalCount = 0;
    let seen = 0;
    // Oldest second the second-grain scan reached. Minute records overlapping
    // it are already accounted for and must not be counted twice.
    let oldestScannedSec = Number.POSITIVE_INFINITY;

    const foldRecord = (rec: TopicRingRecord) => {
      seen += rec.secs;
      totalCount += rec.totalCount;
      for (const e of rec.entries) {
        const cur = merged.get(e.topic);
        if (cur) {
          cur.count += e.count;
          cur.bytes += e.bytes;
        } else if (merged.size < TOPIC_MERGE_CAP) {
          merged.set(e.topic, {
            topic: e.topic,
            count: e.count,
            bytes: e.bytes,
          });
        }
      }
    };

    for (let i = 0; i < topicRingLen && seen < windowSec; i++) {
      const idx =
        ((topicRingHead - i) % TOPIC_RING_CAP + TOPIC_RING_CAP) %
        TOPIC_RING_CAP;
      const rec = topicRing[idx];
      if (!rec) break;
      if (rec.sec <= oldestSec) break;
      oldestScannedSec = rec.sec;
      foldRecord(rec);
    }

    // Beyond the second ring's 15 m the minute rollups carry the window. A
    // minute the second scan already touched is skipped whole: it would
    // double-count, and the seconds it holds are the ones just counted. A
    // minute straddling the start of the window is kept whole, which samples a
    // little more history than asked for, but `secs` divides it honestly.
    if (seen < windowSec) {
      for (let i = 0; i < topicMinuteLen && seen < windowSec; i++) {
        const idx =
          ((topicMinuteHead - i) % TOPIC_MINUTE_RING_CAP +
            TOPIC_MINUTE_RING_CAP) %
          TOPIC_MINUTE_RING_CAP;
        const rec = topicMinuteRing[idx];
        if (!rec) break;
        if (rec.sec <= oldestSec) break;
        if (rec.sec + 60 > oldestScannedSec) continue; // already scanned
        foldRecord(rec);
      }
    }

    // Divide by the seconds actually covered so a partly-elapsed window still
    // reads a true per-second rate.
    const divisor = Math.max(1, seen);

    // Partial-select the top rows by count (O(topics × rows)).
    const topEntries: TopicRingEntry[] = [];
    for (const e of merged.values()) {
      if (topEntries.length < LOUDEST_ROWS) {
        topEntries.push(e);
        topEntries.sort((a, b) => a.count - b.count);
      } else if (e.count > topEntries[0].count) {
        topEntries[0] = e;
        topEntries.sort((a, b) => a.count - b.count);
      }
    }
    // topEntries is ascending; present strongest first.
    const rows: LoudestTopic[] = [];
    let shownCount = 0;
    for (let i = topEntries.length - 1; i >= 0; i--) {
      const e = topEntries[i];
      shownCount += e.count;
      rows.push({
        topic: e.topic,
        msgPerSec: e.count / divisor,
        bytesPerSec: e.bytes / divisor,
      });
    }

    // Everything the rows do not name, from the exact totals rather than from
    // whatever the capture happened to keep. A row can in theory over-state
    // (an evicted counter's correction is a lower bound, not a certainty), so
    // clamp at zero rather than reporting a negative remainder.
    const overflowTopics = Math.max(0, merged.size - rows.length);
    const overflowMsgPerSec = Math.max(0, totalCount - shownCount) / divisor;
    const elapsedSec = (now - openedAt) / 1000;
    return {
      rows,
      overflowTopics,
      overflowMsgPerSec,
      collecting: elapsedSec < windowSec,
    };
  };

  // Rebuilds everything that depends on the selected range: the loudest merge
  // and, past RAW_RANGE_MINUTES, the stitched hero series. `force` bypasses the
  // long-range throttle so a range change is visible at once.
  const refreshRangeDerived = (now: number, force = false) => {
    const long = rangeMinutes > RAW_RANGE_MINUTES;
    if (!long || force || now - lastMergeMs >= LONG_MERGE_INTERVAL_MS) {
      loudestCache = mergeLoudest(rangeMinutes, now);
      lastMergeMs = now;
    }
    if (!long) {
      longSeriesCache = null;
      return;
    }
    // Point references are shared with the raw buffers, so this is a few
    // thousand pointer copies per rebuild, not a copy of the data.
    const out = new Map<string, SparklineSample[]>();
    out.set(
      "observed",
      stitch(observedMinutes.points(), observedSeries, observedMinutes.openMs())
    );
    for (const [key, series] of heroMinutes) {
      const samples = runtime.get(key)?.samples ?? [];
      out.set(key, stitch(series.points(), samples, series.openMs()));
    }
    longSeriesCache = out;
  };

  // --- Learned $SYS interval -------------------------------------------------
  // Fold one live $SYS burst into the EMA. Same-wall-second arrivals collapse
  // to a single burst; the very first burst and any gap spanning a disconnect
  // are skipped so silence/reconnect never poison the interval.
  const foldInterval = (sec: number) => {
    if (sec === lastBurstSec) return; // same burst
    if (lastBurstSec < 0) {
      lastBurstSec = sec;
      return;
    }
    if (intervalGapBroken) {
      intervalGapBroken = false;
      lastBurstSec = sec;
      return; // disconnect-spanning gap excluded
    }
    let gap = sec - lastBurstSec;
    lastBurstSec = sec;
    if (gap < INTERVAL_FLOOR_SEC) gap = INTERVAL_FLOOR_SEC;
    intervalBurstGaps++;
    intervalEmaSec =
      intervalBurstGaps === 1
        ? gap
        : INTERVAL_ALPHA * gap + (1 - INTERVAL_ALPHA) * intervalEmaSec;
    // Seed stays until two burst gaps exist, then the EMA takes over.
    learnedIntervalSec =
      intervalBurstGaps >= 2 ? intervalEmaSec : INTERVAL_SEED_SEC;
  };

  // Folds a set of messages into the store. `observed` feeds the rate counters
  // (live only, never backfill); `perMessageRecompute` re-derives tiles after
  // each tracked message (backfill, so sparkline history + cumulative rates
  // accumulate). Live batches recompute once after the loop instead.
  const ingest = (
    messages: mqtt.MqttMessage[],
    { observed, perMessageRecompute }: { observed: boolean; perMessageRecompute: boolean }
  ) => {
    for (const m of messages) {
      const b64 = m.payload as unknown as string;
      const topic = m.topic;
      const isSys = topic.startsWith("$SYS/");

      if (observed) {
        // base64 decodes to ~3/4 of its length — reused for both rate counters.
        const bytes = Math.floor((b64.length * 3) / 4);
        addObserved(m.timeMs, b64.length);
        // Loudest topics are about USER traffic: $SYS is this window's own
        // instrumentation and would otherwise fill the whole table on a quiet
        // broker with $SYS/# subscribed.
        if (!isSys) addTopicCount(topic, bytes);
        // The learned interval runs off LIVE $SYS bursts only.
        if (isSys) foldInterval(Math.floor(m.timeMs / 1000));
      }

      if (isSys && m.timeMs > sysLastSeenMs) sysLastSeenMs = m.timeMs;

      if (!isSys && !trackedTopics.has(topic)) continue;
      if (isSys) sysEverSeen = true;

      const prev = latest.get(topic);
      if (prev === undefined) {
        if (latest.size >= LATEST_TOPIC_CAP) {
          if (!latestCapWarned) {
            latestCapWarned = true;
            console.warn(
              `broker-status: browsing at most ${LATEST_TOPIC_CAP} topics; further new topics are ignored`
            );
          }
          continue;
        }
        latest.set(topic, { value: base64ToUtf8(b64), timeMs: m.timeMs });
        topicSetVersion++;
      } else if (m.timeMs >= prev.timeMs) {
        latest.set(topic, { value: base64ToUtf8(b64), timeMs: m.timeMs });
      }
      if (perMessageRecompute) recomputeTiles();
    }
    if (!perMessageRecompute) recomputeTiles();
  };

  const updateComputedTile = (key: string, value: number, timeMs: number) => {
    const rt = runtime.get(key);
    if (!rt) return;
    rt.value = value;
    rt.text = null;
    rt.isDuration = false;
    pushSample(key, rt, timeMs, value);
  };

  // Clears a computed/derived tile to the "no data" state (no sample pushed).
  const clearComputedTile = (key: string) => {
    const rt = runtime.get(key);
    if (!rt) return;
    rt.value = null;
    rt.text = null;
    rt.isDuration = false;
  };

  // Derived-rate guard: both rates positive, sampled within one learned
  // interval of each other, and the denominator ≥ 1 /s. A counter reset clamps
  // its rate to 0, which fails "both positive" and voids that interval.
  const derivedRatio = (
    numerKey: string,
    denomKey: string,
    learnedIntervalMs: number
  ): number | null => {
    const numer = runtime.get(numerKey);
    const denom = runtime.get(denomKey);
    if (!numer || !denom) return null;
    if (numer.value === null || denom.value === null) return null;
    if (numer.value <= 0 || denom.value < 1) return null;
    if (Math.abs(numer.lastTimeMs - denom.lastTimeMs) > learnedIntervalMs) {
      return null; // samples don't span the same interval
    }
    return numer.value / denom.value;
  };

  // Fan-out (out/in) and avg msg size (bytes/in), from the hidden cumulative
  // message-total pair + bytes rate. Filled or cleared per the guards above.
  const updateDerivedTiles = (learnedIntervalMs: number) => {
    const fanOut = derivedRatio(
      "messages_sent_total",
      "messages_received_total",
      learnedIntervalMs
    );
    if (fanOut !== null) updateComputedTile(FAN_OUT_KEY, fanOut, Date.now());
    else clearComputedTile(FAN_OUT_KEY);

    // Avg msg size uses the inbound byte rate over the inbound message rate;
    // the *_total pair carries no byte counts, so the numerator is bytes_rate_in
    // (documented deviation — see the spec's "*_total feeds ... avg msg size").
    const avgSize = derivedRatio(
      "bytes_rate_in",
      "messages_received_total",
      learnedIntervalMs
    );
    if (avgSize !== null) updateComputedTile(AVG_MSG_SIZE_KEY, avgSize, Date.now());
    else clearComputedTile(AVG_MSG_SIZE_KEY);
  };

  // Snapshot a metric's runtime as a health input (value + sample trail).
  const healthMetric = (key: string): HealthMetric => {
    const rt = runtime.get(key);
    return { value: rt?.value ?? null, samples: rt?.samples ?? [] };
  };

  // Evaluate the health chips on the tick, persisting hysteresis state.
  const runHealth = (now: number, learnedIntervalMs: number) => {
    const result = evaluateHealth(
      {
        msgs_dropped: healthMetric("msgs_dropped"),
        msg_rate_in: healthMetric("msg_rate_in"),
        delivery_backlog: healthMetric("delivery_backlog"),
        heap_current: healthMetric("heap_current"),
        heap_max: healthMetric("heap_max"),
        store_msgs: healthMetric("store_msgs"),
        store_bytes: healthMetric("store_bytes"),
        sockets_1min: healthMetric("sockets_1min"),
      },
      healthStates,
      now,
      learnedIntervalMs,
      trendFloorMs,
      sysLastSeenMs
    );
    healthStates = result.states;
    healthChips = result.chips;
  };

  // Greys every rendered chip. Called when the connection drops: the tick that
  // would have recomputed staleness has just been stopped, so without this the
  // strip keeps showing a confident green dot on a dead connection.
  const freezeHealthChips = () => {
    healthChips = healthChips.map((c) =>
      c.render && !c.stale ? { ...c, stale: true, qualifier: "" } : c
    );
  };

  const tick = () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const { count, bytes } = sumObserved(nowSec);
    // Warm-up: divide by however long the window has actually been collecting
    // (since open or the last history clear), capped at the full window. Using
    // the full 60 s divisor before 60 s have elapsed under-reports the rate — a
    // burst 5 s after opening would read as 1/12th of its true per-second rate.
    const elapsedSec = Math.max(
      1,
      Math.min(OBSERVED_WINDOW_SEC, (now - openedAt) / 1000)
    );
    updateComputedTile(OBSERVED_MSG_KEY, count / elapsedSec, now);
    updateComputedTile(OBSERVED_BYTE_KEY, bytes / elapsedSec, now);

    // Settled per-second observed series for the hero (off the batch path).
    pushObservedSeries(nowSec);

    // Rotate the open per-topic interval into the ring, then refresh the cached
    // loudest-topics merge and the stitched long series. All run here
    // (once/sec at most), never per message.
    rotateTopicInterval(nowSec);
    refreshRangeDerived(now);

    // Derived ratios + health, both reading the freshly-sampled runtime.
    const learnedIntervalMs = learnedIntervalSec * 1000;
    updateDerivedTiles(learnedIntervalMs);
    runHealth(now, learnedIntervalMs);

    flush(); // one coalesced set per tick
  };

  let tickerId: ReturnType<typeof setInterval> | null = null;
  const startTicker = () => {
    if (tickerId === null) tickerId = setInterval(tick, TICKER_MS);
  };
  const stopTicker = () => {
    if (tickerId !== null) {
      clearInterval(tickerId);
      tickerId = null;
    }
  };

  // Wails listener teardown handles; populated by bindListeners().
  let offMessages: (() => void) | null = null;
  let offClear: (() => void) | null = null;
  let offConnected: (() => void) | null = null;
  let offDisconnected: (() => void) | null = null;
  let offReconnecting: (() => void) | null = null;

  const resetData = () => {
    latest.clear();
    latestCapWarned = false;
    topicSetVersion++;
    selectionVersion = -1;
    selectionByTile.clear();
    cumPrev.clear();
    for (const b of buckets) {
      b.sec = -1;
      b.count = 0;
      b.bytes = 0;
    }
    for (const t of effectiveTiles) runtime.set(t.key, emptyRuntime());
    sysEverSeen = false;
    sysLastSeenMs = -1;

    // Observed instantaneous series, and every minute rollup built from it.
    observedSeries = [];
    lastObservedSec = -1;
    observedMinutes.reset();
    for (const series of heroMinutes.values()) series.reset();
    longSeriesCache = null;

    // Per-topic engine: current interval, both rings, and cached merge.
    curSummary.clear();
    curTotalCount = 0;
    curTotalBytes = 0;
    topicRing.fill(null);
    topicRingHead = -1;
    topicRingLen = 0;
    topicMinuteRing.fill(null);
    topicMinuteHead = -1;
    topicMinuteLen = 0;
    minuteOpen = null;
    lastMergeMs = 0;
    loudestCache = {
      rows: [],
      overflowTopics: 0,
      overflowMsgPerSec: 0,
      collecting: true,
    };

    // Learned $SYS interval EMA.
    lastBurstSec = -1;
    intervalEmaSec = INTERVAL_SEED_SEC;
    intervalBurstGaps = 0;
    learnedIntervalSec = INTERVAL_SEED_SEC;
    intervalGapBroken = false;

    // Health hysteresis state.
    healthStates = new Map();
    healthChips = [];

    // NOTE: raw-browser per-topic prev-values (spec's resetData list) live in
    // raw-browser.ts, which the surfaces commit owns — reset there.

    // Restart the empty-state grace period from the clear.
    openedAt = Date.now();
    // Invalidate any history backfill still in flight (see dataEpoch).
    dataEpoch++;
  };

  // Connection came up (or back up). Trends and tile deltas are held off for a
  // settle period: a restarted broker republishes its retained store, which is
  // a genuine rise that says nothing about broker health.
  const onConnectionUp = () => {
    connected = true;
    everConnected = true;
    trendFloorMs =
      Date.now() +
      Math.max(TREND_SETTLE_MIN_MS, 3 * learnedIntervalSec * 1000);
    startTicker();
    flush();
  };

  // Connection went down, by an explicit disconnect or an outage. Freezes every
  // live surface: rates stop, the observed series breaks rather than drawing
  // zeros, and the chips grey.
  const onConnectionDown = () => {
    connected = false;
    stopTicker(); // freeze observed rates while the broker is unreachable
    // The next $SYS burst's gap spans the down period — exclude it from the
    // learned interval EMA.
    intervalGapBroken = true;
    // Drop the settled-second cursor so the resumed series starts at "now"
    // instead of backfilling one fabricated zero per second of the outage.
    // The view turns the resulting time jump into a line break.
    lastObservedSec = -1;
    freezeHealthChips();
    flush();
  };

  const bindListeners = () => {
    offMessages = Events.On(eventSet.mqttMessages, (e: any) => {
      const messages: mqtt.MqttMessage[] = e.data ?? [];
      ingest(messages, { observed: true, perMessageRecompute: false });
      flush(); // one coalesced set per batch event
    });
    offClear = Events.On(eventSet.mqttClearHistory, () => {
      resetData();
      flush();
    });
    offConnected = Events.On(eventSet.mqttConnected, onConnectionUp);
    offDisconnected = Events.On(eventSet.mqttDisconnected, onConnectionDown);
    // An UNEXPECTED outage emits mqttReconnecting, never mqttDisconnected: the
    // backend keeps the connection object alive while its retry loop runs. To
    // this window that is the same thing as being down, so it takes the same
    // path — otherwise the ticker keeps drawing a fabricated zero trace and the
    // chips stay green for the whole outage.
    offReconnecting = Events.On(eventSet.mqttReconnecting, onConnectionDown);
  };

  const applyMappings = (rows: SysMetricMappingRow[]) => {
    const tiles = mergeMappings(rows);
    // Preserve runtime (sparklines, cumulative state) for unchanged tile keys.
    const nextRuntime = new Map<string, TileRuntime>();
    for (const t of tiles) {
      nextRuntime.set(t.key, runtime.get(t.key) ?? emptyRuntime());
    }
    runtime = nextRuntime;
    effectiveTiles = tiles;
    trackedTopics = new Set(rows.map((r) => r.topic).filter((t) => t !== ""));
    // The tile set changed, so the cached candidate winners are stale.
    selectionVersion = -1;
    selectionByTile.clear();
  };

  // Binding rows satisfy SysMetricMappingRow structurally (id + all fields), so
  // they flow straight through mergeMappings/backfill without a re-map.
  const loadMappings = async () => {
    const rows = (await GetSysMetricMappingsByConnectionId(connectionId)) ?? [];
    applyMappings(rows);
    return rows;
  };

  // Backfills the retained $SYS history. Wrapped so a rejection (backend hiccup)
  // can't abort init() before the ticker starts.
  const backfillSys = async () => {
    const epoch = dataEpoch;
    try {
      const sysHistory = (await GetSysMessageHistory(connectionId)) ?? [];
      if (epoch !== dataEpoch) return; // history cleared mid-fetch → discard
      ingest(sysHistory, { observed: false, perMessageRecompute: true });
    } catch (e) {
      console.error("broker-status: $SYS history backfill failed", e);
    }
  };

  // Backfills exact-topic history for mapped topics that live outside $SYS/
  // (those are not covered by GetSysMessageHistory). Topics are fetched in
  // parallel; each fetch is independent.
  const backfillCustomTopics = async (rows: SysMetricMappingRow[]) => {
    const seen = new Set<string>();
    const topics: string[] = [];
    for (const r of rows) {
      const topic = r.topic;
      if (topic === "" || topic.startsWith("$SYS/")) continue;
      if (seen.has(topic) || latest.has(topic)) continue;
      seen.add(topic);
      topics.push(topic);
    }
    await Promise.all(
      topics.map(async (topic) => {
        const epoch = dataEpoch;
        let hist: mqtt.MqttMessage[];
        try {
          hist = (await GetMessageHistory(connectionId, topic)) ?? [];
        } catch {
          // GetMessageHistory rejects with "topic not found in message history"
          // for a topic that hasn't published yet. A mapping for a not-yet-seen
          // topic is the normal case, so treat it as empty rather than failing.
          return;
        }
        if (epoch !== dataEpoch) return; // history cleared mid-fetch → discard
        ingest(hist, { observed: false, perMessageRecompute: true });
      })
    );
  };

  // Opens the store: binds live listeners first (so nothing is missed during
  // the async backfill), loads mappings, then backfills $SYS + custom topics.
  // The $SYS and custom backfills are independent, so run them together.
  const init = async () => {
    bindListeners();
    const rows = await loadMappings();
    await Promise.all([backfillSys(), backfillCustomTopics(rows)]);
    // A restored long range must have its stitched series before the first
    // tick, or the hero draws one frame off the raw buffers alone.
    refreshRangeDerived(Date.now(), true);
    if (connected) startTicker();
    flush();
  };

  // Re-reads mappings after the editor CRUDs a row. Keeps existing samples for
  // unchanged tiles and backfills any newly-added non-$SYS topic. Returns the
  // freshly-loaded rows so the editor can reuse them instead of re-fetching.
  const reloadMappings = async () => {
    const rows = await loadMappings();
    await backfillCustomTopics(rows);
    recomputeTiles();
    flush();
    return rows;
  };

  const destroy = () => {
    offMessages?.();
    offClear?.();
    offConnected?.();
    offDisconnected?.();
    offReconnecting?.();
    offMessages = offClear = offConnected = null;
    offDisconnected = offReconnecting = null;
    stopTicker();
  };

  // Sets the selected time range in minutes: a preset, or a custom interval
  // that may be fractional (30 s = 0.5) and runs to a day. Drives the hero
  // window and the loudest-topics merge; both are rebuilt immediately so the
  // change is visible without waiting for the next tick.
  const setRange = (minutes: number) => {
    const next = clampRange(minutes);
    if (next === rangeMinutes) return;
    rangeMinutes = next;
    refreshRangeDerived(Date.now(), true);
    flush();
  };

  return {
    subscribe,
    init,
    reloadMappings,
    setRange,
    destroy,
    /** Test/inspection helper: current state snapshot. */
    snapshot: () => get({ subscribe }),
    /** Test/inspection helper: populated depth of the per-topic ring. */
    topicRingSize: () => topicRingLen,
    /** Test/inspection helper: populated depth of the per-minute rollup ring. */
    topicMinuteRingSize: () => topicMinuteLen,
    connectionId,
  };
};
