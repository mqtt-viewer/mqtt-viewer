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
  type SysMetricMappingRow,
} from "./sys-metrics";

/** Max sparkline points retained per tile; older points are trimmed in place. */
export const SPARKLINE_CAP = 300;
/** Ring size for the observed-rate counters: 60 s window + 1 spare bucket. */
export const OBSERVED_BUCKETS = 61;
/** Sliding window (seconds) the observed msgs/s and bytes/s are averaged over. */
export const OBSERVED_WINDOW_SEC = 60;
/** Ticker cadence for recomputing the observed rates. */
export const TICKER_MS = 1000;

export const OBSERVED_MSG_KEY = "observed_msg_rate";
export const OBSERVED_BYTE_KEY = "observed_byte_rate";

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

export interface BrokerStatusState {
  /** Effective tiles (builtins + custom/override mappings), in display order. */
  tiles: BrokerTileView[];
  /** Raw browser data: newest decoded value per $SYS/* or mapped topic. */
  latestByTopic: Map<string, LatestTopicEntry>;
  /** Broker connection up/down, driven by the connection's Wails events. */
  connected: boolean;
  /** True once any $SYS/* message has been seen (backfill or live). */
  sysEverSeen: boolean;
  /** Epoch ms the window/store opened — the view's 10 s empty-state grace. */
  windowOpenedAt: number;
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

const emptyRuntime = (): TileRuntime => ({
  samples: [],
  value: null,
  text: null,
  isDuration: false,
  lastTimeMs: -1,
  lastTopic: "",
});

export const createBrokerStatusStore = (
  connectionId: number,
  eventSet: events.ConnectionEventsSet,
  opts: { connected?: boolean } = {}
) => {
  // Effective tiles + per-tile runtime, keyed by tile.key. Runtime survives a
  // mappings reload for tiles whose key is unchanged (preserving sparklines).
  let effectiveTiles: MetricTile[] = mergeMappings([]);
  let runtime = new Map<string, TileRuntime>();
  for (const t of effectiveTiles) runtime.set(t.key, emptyRuntime());

  // Exact topics from custom/override mappings (may be outside $SYS/). Decoded
  // and browsable alongside $SYS/*.
  let trackedTopics = new Set<string>();

  // Raw-browser data: newest decoded value per browsed topic.
  const latest = new Map<string, LatestTopicEntry>();

  // Last {value,timeMs} per cumulative tile, for deriving a /s rate.
  const cumPrev = new Map<string, { value: number; timeMs: number }>();

  // Observed-rate counters: fixed ring, one bucket per wall second.
  const buckets: ObservedBucket[] = Array.from(
    { length: OBSERVED_BUCKETS },
    () => ({ sec: -1, count: 0, bytes: 0 })
  );

  let sysEverSeen = false;
  let connected = opts.connected ?? true;
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

  const buildState = (): BrokerStatusState => ({
    tiles: effectiveTiles.map(buildTile),
    latestByTopic: latest,
    connected,
    sysEverSeen,
    windowOpenedAt: openedAt,
  });

  const { subscribe, set } = writable<BrokerStatusState>(buildState());
  const flush = () => set(buildState());

  const pushSample = (rt: TileRuntime, t: number, v: number) => {
    rt.samples.push({ t, v });
    if (rt.samples.length > SPARKLINE_CAP) rt.samples.shift();
  };

  // Re-evaluates every non-computed tile against the current `latest` topics.
  // Cheap (≈ a dozen tiles); the per-tile timeMs guard makes repeat calls no-op
  // when nothing new arrived, so calling it once per batch is enough.
  const recomputeTiles = () => {
    const topics = Array.from(latest.keys());
    for (const tile of effectiveTiles) {
      if (tile.computed) continue;
      const rt = runtime.get(tile.key);
      if (!rt) continue;
      const sel = selectCandidate(tile, topics);
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
          pushSample(rt, entry.timeMs, rate);
        }
        // First cumulative sample yields no rate yet: nothing to display.
        continue;
      }

      rt.isDuration = sel.candidate.kind === "duration";
      rt.value = parsed.value;
      pushSample(rt, entry.timeMs, parsed.value);
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
      if (observed) addObserved(m.timeMs, b64.length);

      const topic = m.topic;
      const isSys = topic.startsWith("$SYS/");
      if (!isSys && !trackedTopics.has(topic)) continue;

      const decoded = base64ToUtf8(b64);
      const prev = latest.get(topic);
      if (!prev || m.timeMs >= prev.timeMs) {
        latest.set(topic, { value: decoded, timeMs: m.timeMs });
      }
      if (isSys) sysEverSeen = true;
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
    pushSample(rt, timeMs, value);
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

  const resetData = () => {
    latest.clear();
    cumPrev.clear();
    for (const b of buckets) {
      b.sec = -1;
      b.count = 0;
      b.bytes = 0;
    }
    for (const t of effectiveTiles) runtime.set(t.key, emptyRuntime());
    sysEverSeen = false;
    // Restart the empty-state grace period from the clear.
    openedAt = Date.now();
    // Invalidate any history backfill still in flight (see dataEpoch).
    dataEpoch++;
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
    offConnected = Events.On(eventSet.mqttConnected, () => {
      connected = true;
      startTicker();
      flush();
    });
    offDisconnected = Events.On(eventSet.mqttDisconnected, () => {
      connected = false;
      stopTicker(); // freeze observed rates while disconnected
      flush();
    });
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
          // limit 0 = no limit: the backfill wants the topic's full retained
          // window so observed rates recompute from complete history.
          hist = (await GetMessageHistory(connectionId, topic, 0)) ?? [];
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
    offMessages = offClear = offConnected = offDisconnected = null;
    stopTicker();
  };

  return {
    subscribe,
    init,
    reloadMappings,
    destroy,
    /** Test/inspection helper: current state snapshot. */
    snapshot: () => get({ subscribe }),
    connectionId,
  };
};
