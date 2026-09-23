// Data store for the Sparkplug session tree (the Sparkplug view of the data
// panel). It folds the backend's already-enriched Sparkplug messages (the
// middlewareProperties["sparkplug"] meta plus name-injected protojson
// payloads) into a live group -> edge node -> device -> metric inventory with
// health diagnostics: seq-gap flags, rebirth-storm warnings and host STATE
// tracking. See docs/specs/research/stateful-sparkplug-decode.md.
//
// Order independence. Live batches and the history replay interleave in any
// order, so nothing here depends on the order messages are folded in. The
// backend stamps every Sparkplug message with its arrival order ("n" in the
// meta, a counter that never ties, unlike millisecond times), and every scope
// keeps the newest order of each kind of signal (birth, data, seq gap) and
// its recent deaths. Visible state is derived from those: a node is online
// when its newest sign of life is newer than its newest death, a birth only
// replaces metrics older than it and only the newest birth declares types
// and units, a seq gap only counts when newer than the birth, and data from
// before a birth, or before a death a new session followed, belongs to a
// finished session. Folding the same messages in any order lands on the same
// tree (sparkplug-tree-store.fuzz.test.ts checks this).
//
// Connection drops. Nothing the client missed while disconnected can be
// known: a node may have died, or rebirthed with new aliases. So on a drop the
// tree keeps its last values, but status only counts signals received after
// the drop (unknown until a node is heard from again) and names from births
// before it are flagged unverified until the node births again. The backend
// flags the same data with carriedOver, and reports its own last drop in the
// replay so a view opened later knows too.
//
// Hidden view. The store runs whenever the connection's data panel is open,
// but the tree only matters while the Sparkplug view is showing. While it is
// hidden the store folds only what is cheap and feeds the view toggle
// (whether Sparkplug traffic exists, warnings, liveness): no payload is
// decoded and no tree is built. Opening the view replays the backend's
// snapshot (every scope's birth and death and the latest value of every
// metric) and folds live from then on.
//
// Performance contract (mirrors broker-status-store):
//   - The all-messages feed does a cheap early exit per message: anything
//     without sparkplug middleware meta costs one property read, no allocs.
//   - Svelte store writes are coalesced: at most one `set` per incoming batch
//     event and one per 1 s ticker tick, never per message.
//   - Snapshots are incremental: only nodes and metrics touched since the
//     last snapshot are rebuilt; everything else reuses the previous objects.
//   - State is bounded by hard caps, not by traffic: MAX_TRACKED_NODES nodes
//     (the least recently heard is evicted for a new one, as in the backend),
//     MAX_TRACKED_DEVICES devices per node, MAX_METRICS_PER_SCOPE metrics and
//     MAX_PLACEHOLDER_METRICS alias placeholders per scope, MAX_METRICS_TOTAL
//     metrics in all, MAX_VALUE_CHARS per value and MAX_VALUE_CHARS_TOTAL of
//     values in all (these mirror the backend session caps),
//     MAX_TRACKED_HOSTS hosts, warnings at WARNING_CAP and the per-node birth
//     ring at BIRTH_RING_CAP. Over-cap keys are dropped, with one console.warn
//     per store per cap kind.
//   - A replay is folded in chunks that yield to the renderer, so opening
//     the view on a capped session never blocks it for long.

import { get, writable } from "svelte/store";
import { Events } from "@wailsio/runtime";
import type * as events from "bindings/mqtt-viewer/events/models";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import {
  GetSparkplugMessageHistory,
  GetSparkplugSuspendedOrd,
} from "bindings/mqtt-viewer/backend/app/app";
import {
  datatypeName,
  formatMetricValue,
  qualityLabel,
  readMetricProperties,
  type PayloadMetric,
} from "./sparkplug-values";

export { datatypeName } from "./sparkplug-values";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();

/**
 * Decodes a base64 payload to text. Perf-sensitive: this runs for every
 * Sparkplug message in a batch, and the generic
 * `Uint8Array.from(binary, cb)` path costs ~20 µs per payload (it dominated
 * the flood benchmark). Protojson payloads are almost always pure ASCII, so
 * take the atob result directly when no byte exceeds 0x7F and only fall back
 * to a real UTF-8 decode for multibyte content.
 */
const base64ToText = (b64: string): string => {
  const binary = atob(b64);
  let ascii = true;
  for (let i = 0; i < binary.length; i++) {
    if (binary.charCodeAt(i) > 127) {
      ascii = false;
      break;
    }
  }
  if (ascii) return binary;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return utf8Decoder.decode(bytes);
};

/** Warnings strip cap; oldest entries are dropped, newest kept last. */
export const WARNING_CAP = 50;
/** Per-node birth-timestamp ring size for rebirth-storm detection. */
export const BIRTH_RING_CAP = 16;
/** A storm is >= this many births within REBIRTH_STORM_WINDOW_MS. */
export const REBIRTH_STORM_COUNT = 4;
export const REBIRTH_STORM_WINDOW_MS = 90_000;
/** Identical seq-gap warnings from one node in the same window are deduped. */
export const SEQ_GAP_DEDUPE_MS = 5_000;
/** Ticker cadence for relative last-seen labels. */
export const TICKER_MS = 1000;
/** Total edge nodes tracked across all groups (mirrors the backend cap). */
export const MAX_TRACKED_NODES = 4096;
/** Devices tracked per edge node (mirrors the backend cap). */
export const MAX_TRACKED_DEVICES = 1024;
/** Metrics kept per node or device (mirrors the backend cap). */
export const MAX_METRICS_PER_SCOPE = 16384;
/** Metrics kept across the whole connection (mirrors the backend cap). */
export const MAX_METRICS_TOTAL = 1 << 18;
/**
 * `alias_<n>` placeholder metrics kept per scope. Placeholders are minted by
 * an unbirthed publisher cycling aliases, so they get a tighter cap of their
 * own on top of MAX_METRICS_PER_SCOPE.
 */
export const MAX_PLACEHOLDER_METRICS = 256;
/** STATE host ids tracked (mirrors the backend cap). */
export const MAX_TRACKED_HOSTS = 256;
/** Message ids remembered for warning de-duplication (FIFO). */
export const WARNED_ID_CAP = 256;
/** Fallback delay for the deferred backfill when no trigger fires first. */
export const BACKFILL_IDLE_MS = 2000;
/**
 * Largest value kept for display and copy: bytes on the wire for strings and
 * byte arrays (the backend's 256 KB index limit), characters once formatted.
 * A bigger one shows its size, and the message it came from holds the value.
 */
export const MAX_VALUE_CHARS = 256 * 1024;
/** Characters of values kept across the connection (mirrors the backend). */
export const MAX_VALUE_CHARS_TOTAL = 64 * 1024 * 1024;
/** Deaths remembered per scope, to place restarts between them. */
const DEATH_HISTORY_CAP = 64;
/** Replay folding yields to the renderer after about this much payload. */
const REPLAY_CHUNK_CHARS = 1_000_000;

// --- Public state shape (buildState snapshot) ---------------------------------

/**
 * online: the newest signal since the last connection drop was a birth or
 * data. offline: it was a death. unknown: nothing heard since the drop (or
 * ever), so there is no telling.
 */
export type SparkplugStatus = "online" | "offline" | "unknown";

export interface SparkplugHost {
  hostId: string;
  online: boolean;
  sinceMs: number;
}

export interface SparkplugMetric {
  name: string;
  /** True when the name is an `alias_<n>` stand-in (no birth seen). */
  placeholder: boolean;
  /** Sparkplug datatype code, from the metric or its birth. */
  datatype?: number;
  typeName: string;
  /** Display value, exact for scalars (see sparkplug-values.ts). */
  value: string;
  /** Full value for copy. */
  valueRaw: string;
  /** Engineering unit from the metric's properties, when published. */
  unit?: string;
  /** Short label when the published quality is not good ("bad", "stale"). */
  quality?: string;
  qualityCode?: number;
  /** Arrival time of the message that last updated this metric. */
  lastSeenMs: number;
  /** Device-reported timestamp (metric or payload level); clocks lie. */
  payloadTsMs?: number;
  /** Topic and id of the message that last updated this metric. */
  topic: string;
  messageId?: string;
  isNull?: boolean;
  isHistorical?: boolean;
  isTransient?: boolean;
  /**
   * The value was too big to keep (see MAX_VALUE_CHARS): value says how big,
   * valueRaw is empty, and the message it came from has it.
   */
  omitted?: boolean;
}

interface ScopeCommon {
  name: string;
  status: SparkplugStatus;
  /** Convenience: status === "online". */
  online: boolean;
  /** A birth for this scope has been seen and not superseded by a death. */
  hasBirth: boolean;
  birthAtMs?: number;
  /**
   * False when the names shown come from a birth received before the last
   * connection drop: the node may have rebirthed with new aliases unseen.
   */
  verified: boolean;
  metrics: SparkplugMetric[];
  /** Newest sign of life (birth or data). */
  lastSeenMs: number;
  deathAtMs?: number;
  /** Placeholder metrics currently shown (unresolved aliases). */
  placeholderCount: number;
}

export interface SparkplugDevice extends ScopeCommon {
  /** The node rebirthed after this device's last birth; a DBIRTH is due. */
  awaitingBirth: boolean;
}

export interface SparkplugNode extends ScopeCommon {
  group: string;
  bdSeq?: number;
  seqOk: boolean;
  lastSeqGap?: { expected: number; got: number };
  metricCount: number;
  devices: SparkplugDevice[];
  /** A rebirth storm warning is live for this node. */
  storm: boolean;
}

export interface SparkplugGroup {
  name: string;
  nodes: SparkplugNode[];
}

export type SparkplugWarningKind = "seq-gap" | "rebirth-storm";

export interface SparkplugWarning {
  group: string;
  /** Edge node display name, e.g. "substation-4". */
  node: string;
  text: string;
  timeMs: number;
  kind: SparkplugWarningKind;
}

export interface SparkplugTreeState {
  hasSparkplug: boolean;
  /** Whether the connection is up right now. */
  connected: boolean;
  /** When the connection last dropped, if it has since this store started. */
  droppedAtMs?: number;
  /** The history replay for an opened view is in flight. */
  replaying: boolean;
  hosts: SparkplugHost[];
  groups: SparkplugGroup[];
  /** Capped at WARNING_CAP, newest last. */
  warnings: SparkplugWarning[];
  warningCount: number;
  /** Reference "now" for relative last-seen rendering. */
  nowMs: number;
}

export type SparkplugTreeStore = ReturnType<typeof createSparkplugTreeStore>;

// --- Internal runtime (mutated in place; snapshotted by buildState) -----------

interface MetricRt {
  name: string;
  placeholder: boolean;
  /**
   * The payload metric the value came from, kept to re-format it when a
   * newer declaration of the datatype arrives (a birth replayed after data).
   */
  source: PayloadMetric;
  datatype?: number;
  /** Order of the message that declared the datatype in use. */
  datatypeOrd: number;
  value: string;
  valueRaw: string;
  unit?: string;
  unitOrd: number;
  qualityCode?: number;
  /** Order and time of the message that last updated the value. */
  lastSeenOrd: number;
  lastSeenMs: number;
  payloadTsMs?: number;
  topic: string;
  messageId?: string;
  isNull?: boolean;
  isHistorical?: boolean;
  isTransient?: boolean;
  /** Size of a value too big to keep, in bytes or characters. */
  omittedSize?: number;
  /** Characters this metric holds against MAX_VALUE_CHARS_TOTAL. */
  chars: number;
  /** Snapshot cache, cleared whenever the metric changes. */
  built: SparkplugMetric | null;
}

interface ScopeRt {
  name: string;
  metrics: Map<string, MetricRt>;
  /** Metric keys in display order; null after a metric is added or removed. */
  sortedKeys: string[] | null;
  /** Placeholder (`alias_<n>`) metrics currently in `metrics`. */
  placeholderCount: number;
  /** Order and time of the newest birth folded in. */
  birthOrd?: number;
  birthAtMs?: number;
  /** Order and time of the newest sign of life (birth or data). */
  lastAliveOrd: number;
  lastAliveMs: number;
  /** Order and time of the newest death. */
  deathOrd?: number;
  /**
   * Recent deaths, oldest first (capped at DEATH_HISTORY_CAP). A restart
   * between two deaths is only visible with more than the newest.
   */
  deathOrds: number[];
  deathAtMs?: number;
  /**
   * Newest data the backend flagged carriedOver: names resolved from a birth
   * that predates a connection drop, possibly before this store existed.
   */
  carriedOverOrd?: number;
}

type DeviceRt = ScopeRt;

interface NodeRt extends ScopeRt {
  group: string;
  /**
   * Order of the node's newest message of any kind (its devices' included),
   * for evicting the least recently heard node, as the backend does.
   */
  lastOrd: number;
  bdSeq?: number;
  /** Order of the birth or death the bdSeq came from. */
  bdSeqOrd?: number;
  lastSeqGap?: { expected: number; got: number };
  lastSeqGapOrd?: number;
  /** NBIRTH arrivals (capped), sorted by time, for storm detection. */
  birthRing: { id?: string; timeMs: number }[];
  /** The storm warning currently attached to this node, if a storm is live. */
  stormWarning: SparkplugWarning | null;
  /** Recent seq-gap warnings by "expected-got-window", for the dedupe. */
  seqGapKeys: Map<string, SparkplugWarning>;
  devices: Map<string, DeviceRt>;
  /** Snapshot cache: rebuilt only when dirty. */
  dirty: boolean;
  built: SparkplugNode | null;
}

/** Sparkplug meta attached by the backend middleware (see backend/sparkplug). */
interface SparkplugMeta {
  msgType: string;
  group?: string;
  edgeNode?: string;
  device?: string;
  hostId?: string;
  resolution?: string;
  birthAtMs?: number;
  carriedOver?: boolean;
  seqGap?: { expected: number; got: number };
  bdSeq?: number;
  /** The backend's arrival order for this message. */
  n?: number;
  /**
   * Set by the backend when an NDEATH's bdSeq does not match the live
   * session's birth: a late death from a superseded session, which must not
   * take the current session offline.
   */
  staleDeath?: boolean;
  /** The message's retain flag (with MQTT 5, live messages can carry it). */
  retained?: boolean;
  /**
   * A retained birth the broker delivered again, identical to the one the
   * backend already holds: nothing changed, so it is ignored.
   */
  staleBirth?: boolean;
  /** Replayed values too big to index, by metric key, with their size. */
  omitted?: Record<string, number>;
}

/** Replay payload from GetSparkplugMessageHistory. */
interface SparkplugHistory {
  messages: mqtt.MqttMessage[] | null;
  suspendedOrd: number;
}

const formatSize = (n: number): string =>
  n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : n >= 1024
      ? `${Math.round(n / 1024)} KB`
      : `${n} bytes`;

/** Yields to the renderer between replay chunks. Not a timer: fake timers in tests must not stall it. */
const yieldToMain = (): Promise<void> =>
  typeof MessageChannel === "undefined"
    ? Promise.resolve()
    : new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });

const metricKey = (m: PayloadMetric): string => {
  if (m.name !== undefined && m.name !== "") return m.name;
  return `alias_${m.alias ?? "?"}`;
};

const parseTsMs = (
  metricTs: string | number | undefined,
  payloadTs: string | number | undefined
): number | undefined => {
  const raw = metricTs ?? payloadTs;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Newest of two optional numbers. */
const newest = (a: number | undefined, b: number | undefined) =>
  a === undefined ? b : b === undefined ? a : Math.max(a, b);

export const createSparkplugTreeStore = (
  connectionId: number,
  eventSet: events.ConnectionEventsSet,
  opts: { connected?: boolean } = {}
) => {
  // group name -> (edge node name -> node runtime)
  const groups = new Map<string, Map<string, NodeRt>>();
  const hosts = new Map<string, { online: boolean; sinceMs: number; atOrd: number }>();
  let warnings: SparkplugWarning[] = [];
  let hasSparkplug = false;

  let connected = opts.connected ?? true;
  // Order of the last connection drop: signals at or below it predate the
  // drop. Wall-clock time of the drop is kept only for display.
  let droppedAtOrd: number | undefined = undefined;
  let droppedAtMs: number | undefined = connected ? undefined : Date.now();
  // Highest order seen, so a drop can be placed after everything received.
  let maxOrdSeen = 0;
  // Newest arrival time seen (the backend's clock), to age storms without
  // comparing the backend's clock with this machine's.
  let maxTimeSeen = 0;
  // Nodes whose storm badge is showing and may need to expire.
  const stormNodes = new Set<NodeRt>();

  // Whether the Sparkplug view is showing (see "Hidden view" above).
  let active = false;
  let replaying = false;

  // Bumped on clear-history so an in-flight replay can't resurrect state.
  let dataEpoch = 0;

  // Set by destroy(); guards against a replay continuation running (and
  // leaking a ticker) after the store has been torn down.
  let destroyed = false;

  let idleBackfillTimer: ReturnType<typeof setTimeout> | null = null;
  let idleBackfillDone = false;

  // Totals kept as counters so cap checks never walk the maps on the hot
  // path.
  let nodeCount = 0;
  let metricCount = 0;
  let valueChars = 0;
  // Snapshot cache for the group list: rebuilt only when the set of groups or
  // nodes changes.
  let structureChanged = true;
  let sortedGroupKeys: string[] = [];
  const sortedNodeKeys = new Map<string, string[]>();
  let lastGroups: SparkplugGroup[] = [];
  const lastGroupByName = new Map<string, SparkplugGroup>();

  // One warning per store per cap kind: a flood must never warn per message.
  const capWarned = {
    node: false,
    device: false,
    metric: false,
    placeholder: false,
    host: false,
  };
  const warnCapOnce = (kind: keyof typeof capWarned, text: string) => {
    if (capWarned[kind]) return;
    capWarned[kind] = true;
    console.warn(text);
  };

  const markAllDirty = () => {
    for (const nodes of groups.values()) {
      for (const node of nodes.values()) node.dirty = true;
    }
  };

  const findNode = (group: string, name: string) => groups.get(group)?.get(name);

  const scopeMetricsGone = (scope: ScopeRt) => {
    for (const m of scope.metrics.values()) valueChars -= m.chars;
    metricCount -= scope.metrics.size;
  };

  /**
   * Makes room at the node cap by dropping the least recently heard node,
   * dead ones first, the same choice the backend makes. A connection that
   * churns through ephemeral node ids keeps following the live ones.
   */
  const evictNode = (): boolean => {
    let victim: NodeRt | null = null;
    let victimDead = false;
    let victimLast = 0;
    for (const nodes of groups.values()) {
      for (const n of nodes.values()) {
        const last = n.lastOrd;
        // Its last word was its own death.
        const dead = n.deathOrd !== undefined && n.deathOrd === n.lastOrd;
        if (victim === null || (dead && !victimDead) || (dead === victimDead && last < victimLast)) {
          victim = n;
          victimDead = dead;
          victimLast = last;
        }
      }
    }
    if (victim === null) return false;
    scopeMetricsGone(victim);
    for (const d of victim.devices.values()) scopeMetricsGone(d);
    const nodes = groups.get(victim.group)!;
    nodes.delete(victim.name);
    if (nodes.size === 0) {
      groups.delete(victim.group);
      lastGroupByName.delete(victim.group);
    }
    stormNodes.delete(victim);
    nodeCount--;
    structureChanged = true;
    return true;
  };

  /** Returns null only when the node is new and nothing could be evicted. */
  const ensureNode = (group: string, name: string): NodeRt | null => {
    let nodes = groups.get(group);
    let node = nodes?.get(name);
    if (node) return node;
    if (nodeCount >= MAX_TRACKED_NODES) {
      warnCapOnce(
        "node",
        `sparkplug-tree: node cap reached (${MAX_TRACKED_NODES}), dropping the least recently heard`
      );
      if (!evictNode()) return null;
      nodes = groups.get(group);
    }
    if (!nodes) {
      nodes = new Map();
      groups.set(group, nodes);
    }
    node = {
      group,
      name,
      metrics: new Map(),
      sortedKeys: null,
      placeholderCount: 0,
      lastAliveOrd: 0,
      lastAliveMs: 0,
      deathOrds: [],
      lastOrd: 0,
      birthRing: [],
      stormWarning: null,
      seqGapKeys: new Map(),
      devices: new Map(),
      dirty: true,
      built: null,
    };
    nodes.set(name, node);
    nodeCount++;
    structureChanged = true;
    return node;
  };

  /** Returns null when the device is new and the per-node cap is reached. */
  const ensureDevice = (node: NodeRt, name: string): DeviceRt | null => {
    let device = node.devices.get(name);
    if (!device) {
      if (node.devices.size >= MAX_TRACKED_DEVICES) {
        warnCapOnce(
          "device",
          `sparkplug-tree: device cap reached (${MAX_TRACKED_DEVICES}) on an edge node, ignoring new devices`
        );
        return null;
      }
      device = {
        name,
        metrics: new Map(),
        sortedKeys: null,
        placeholderCount: 0,
        lastAliveOrd: 0,
        lastAliveMs: 0,
        deathOrds: [],
      };
      node.devices.set(name, device);
    }
    return device;
  };

  // Warnings are kept in time order, so the list, and which ones the cap
  // drops, don't depend on the order messages were folded in.
  const sortWarnings = () => {
    warnings.sort((a, b) => a.timeMs - b.timeMs);
  };

  const pushWarning = (w: SparkplugWarning) => {
    let i = warnings.length;
    while (i > 0 && warnings[i - 1].timeMs > w.timeMs) i--;
    warnings.splice(i, 0, w);
    if (warnings.length > WARNING_CAP) {
      const evicted = warnings.shift()!;
      // A node's storm badge reads its warning's presence in this list.
      if (evicted.kind === "rebirth-storm") {
        const node = findNode(evicted.group, evicted.node);
        if (node) node.dirty = true;
      }
    }
  };

  // Message ids already counted towards a warning. A duplicate delivery (a
  // replay overlapping live traffic) would otherwise double count.
  // Insertion-ordered Set used as a bounded FIFO.
  const warnedIds = new Set<string>();
  const rememberWarnedId = (id: string) => {
    warnedIds.add(id);
    if (warnedIds.size > WARNED_ID_CAP) {
      const oldest = warnedIds.values().next().value;
      if (oldest !== undefined) warnedIds.delete(oldest);
    }
  };

  // --- Derived state ----------------------------------------------------------

  /** An order after the last drop, or undefined when before it or missing. */
  const sinceDrop = (ord: number | undefined): number | undefined => {
    if (ord === undefined || ord <= 0) return undefined;
    if (droppedAtOrd !== undefined && ord <= droppedAtOrd) return undefined;
    return ord;
  };

  const statusOf = (aliveOrd: number, deathOrd: number | undefined): SparkplugStatus => {
    if (!connected) return "unknown";
    const alive = sinceDrop(aliveOrd);
    const dead = sinceDrop(deathOrd);
    if (alive === undefined && dead === undefined) return "unknown";
    if (dead === undefined) return "online";
    if (alive === undefined) return "offline";
    return alive > dead ? "online" : "offline";
  };

  const isVerified = (scope: ScopeRt) =>
    scope.birthOrd !== undefined &&
    (droppedAtOrd === undefined || scope.birthOrd > droppedAtOrd) &&
    (scope.carriedOverOrd === undefined || scope.birthOrd > scope.carriedOverOrd);

  // --- Snapshot ---------------------------------------------------------------

  const buildMetric = (rt: MetricRt): SparkplugMetric => ({
    name: rt.name,
    placeholder: rt.placeholder,
    datatype: rt.datatype,
    typeName: datatypeName(rt.datatype),
    value: rt.value,
    valueRaw: rt.valueRaw,
    unit: rt.unit,
    quality: qualityLabel(rt.qualityCode) ?? undefined,
    qualityCode: rt.qualityCode,
    lastSeenMs: rt.lastSeenMs,
    payloadTsMs: rt.payloadTsMs,
    topic: rt.topic,
    messageId: rt.messageId,
    isNull: rt.isNull,
    isHistorical: rt.isHistorical,
    isTransient: rt.isTransient,
    omitted: rt.omittedSize !== undefined ? true : undefined,
  });

  // Only metrics that changed since the last snapshot get a new object, and
  // the sort only reruns when the metric set changes: at fleet scale a batch
  // touches a handful of metrics on most nodes, not every metric.
  const buildMetrics = (scope: ScopeRt): SparkplugMetric[] => {
    if (scope.sortedKeys === null) {
      scope.sortedKeys = Array.from(scope.metrics.keys()).sort();
    }
    const out: SparkplugMetric[] = new Array(scope.sortedKeys.length);
    for (let i = 0; i < scope.sortedKeys.length; i++) {
      const rt = scope.metrics.get(scope.sortedKeys[i])!;
      if (rt.built === null) rt.built = buildMetric(rt);
      out[i] = rt.built;
    }
    return out;
  };

  /**
   * A storm is live while its warning is still listed and births kept
   * coming within the storm window of the newest message seen: once a node
   * settles, the badge goes (the warning stays in the list).
   */
  /** "Now" for ages and expiry: frozen at the drop while disconnected. */
  const referenceNow = () => (connected || droppedAtMs === undefined ? Date.now() : droppedAtMs);

  // Expires against the clock as well as the newest message, so a storm
  // that stopped clears even when nothing else arrives.
  const stormActive = (n: NodeRt) => {
    if (n.stormWarning === null || !warnings.includes(n.stormWarning)) return false;
    const lastBirth = n.birthRing[n.birthRing.length - 1]?.timeMs ?? 0;
    return Math.max(maxTimeSeen, referenceNow()) - lastBirth <= REBIRTH_STORM_WINDOW_MS;
  };

  /** A birth that no newer death has ended. */
  const hasLiveBirth = (birthOrd: number | undefined, deathOrd: number | undefined) =>
    birthOrd !== undefined && (deathOrd === undefined || birthOrd > deathOrd);

  const buildNode = (n: NodeRt): SparkplugNode => {
    const devices: SparkplugDevice[] = [];
    for (const dName of Array.from(n.devices.keys()).sort()) {
      const d = n.devices.get(dName)!;
      // A node's death takes its devices with it, and its birth ends their
      // sessions: a device birth older than the node's is not current.
      const deviceDeathOrd = newest(d.deathOrd, n.deathOrd);
      const deviceDeathMs = d.deathOrd === deviceDeathOrd ? d.deathAtMs : n.deathAtMs;
      const currentBirth =
        d.birthOrd !== undefined && (n.birthOrd === undefined || d.birthOrd > n.birthOrd);
      const deviceHasBirth = currentBirth && hasLiveBirth(d.birthOrd, deviceDeathOrd);
      const awaitingBirth = n.birthOrd !== undefined && !currentBirth && d.metrics.size === 0;
      const status = statusOf(d.lastAliveOrd, deviceDeathOrd);
      devices.push({
        name: d.name,
        status,
        online: status === "online",
        hasBirth: deviceHasBirth,
        birthAtMs: currentBirth ? d.birthAtMs : undefined,
        verified: deviceHasBirth && isVerified(d),
        metrics: buildMetrics(d),
        lastSeenMs: d.lastAliveMs,
        deathAtMs: deviceDeathMs,
        placeholderCount: d.placeholderCount,
        awaitingBirth,
      });
    }
    const status = statusOf(n.lastAliveOrd, n.deathOrd);
    const nodeHasBirth = hasLiveBirth(n.birthOrd, n.deathOrd);
    const seqOk =
      n.lastSeqGapOrd === undefined ||
      (n.birthOrd !== undefined && n.birthOrd > n.lastSeqGapOrd);
    return {
      group: n.group,
      name: n.name,
      status,
      online: status === "online",
      bdSeq: n.bdSeq,
      seqOk,
      lastSeqGap: seqOk ? undefined : n.lastSeqGap,
      metricCount: n.metrics.size,
      birthAtMs: n.birthAtMs,
      lastSeenMs: n.lastAliveMs,
      metrics: buildMetrics(n),
      devices,
      hasBirth: nodeHasBirth,
      verified: nodeHasBirth && isVerified(n),
      deathAtMs: n.deathAtMs,
      placeholderCount: n.placeholderCount,
      storm: stormActive(n),
    };
  };

  const buildGroups = (): SparkplugGroup[] => {
    // A storm badge can expire with no message for its node.
    for (const node of stormNodes) {
      node.dirty = true;
      if (!stormActive(node)) stormNodes.delete(node);
    }
    if (structureChanged) {
      sortedGroupKeys = Array.from(groups.keys()).sort();
      sortedNodeKeys.clear();
      for (const [g, nodes] of groups) {
        sortedNodeKeys.set(g, Array.from(nodes.keys()).sort());
      }
    }
    let groupsChanged = structureChanged;
    const outGroups: SparkplugGroup[] = [];
    for (const groupName of sortedGroupKeys) {
      const nodes = groups.get(groupName)!;
      let anyDirty = structureChanged;
      for (const node of nodes.values()) {
        if (node.dirty || node.built === null) {
          node.built = buildNode(node);
          node.dirty = false;
          anyDirty = true;
        }
      }
      const previous = lastGroupByName.get(groupName);
      if (!anyDirty && previous) {
        outGroups.push(previous);
        continue;
      }
      groupsChanged = true;
      const group: SparkplugGroup = {
        name: groupName,
        nodes: sortedNodeKeys.get(groupName)!.map((k) => nodes.get(k)!.built!),
      };
      lastGroupByName.set(groupName, group);
      outGroups.push(group);
    }
    structureChanged = false;
    if (groupsChanged) lastGroups = outGroups;
    return lastGroups;
  };

  const buildState = (): SparkplugTreeState => {
    const nowMs = referenceNow();
    const outHosts: SparkplugHost[] = [];
    for (const hostId of Array.from(hosts.keys()).sort()) {
      const h = hosts.get(hostId)!;
      outHosts.push({ hostId, online: h.online, sinceMs: h.sinceMs });
    }
    return {
      hasSparkplug,
      connected,
      droppedAtMs,
      replaying,
      hosts: outHosts,
      // Nobody renders the tree while the view is hidden, so don't build it.
      groups: active ? buildGroups() : lastGroups,
      warnings,
      warningCount: warnings.length,
      nowMs,
    };
  };

  const { subscribe, set } = writable<SparkplugTreeState>(buildState());
  const flush = () => set(buildState());

  // --- Message processing -----------------------------------------------------

  const parsePayload = (m: mqtt.MqttMessage): any | null => {
    try {
      const text = base64ToText(m.payload as unknown as string);
      if (text === "") return null;
      return JSON.parse(text);
    } catch {
      return null; // empty/garbled payloads (e.g. nil NDEATH) are fine
    }
  };

  /** Bytes of a string or bytes value on the wire. */
  const wireBytes = (pm: PayloadMetric): number => {
    let n = 0;
    const str = pm.stringValue;
    if (str !== undefined) {
      // UTF-8 is at most 3 bytes per UTF-16 unit; count exactly only when
      // that bound could reach the limit.
      n += str.length * 3 > MAX_VALUE_CHARS ? utf8Encoder.encode(str).length : str.length;
    }
    if (pm.bytesValue !== undefined) n += Math.floor((pm.bytesValue.length * 3) / 4);
    return n;
  };

  /** The payload metric with its value fields dropped. */
  const withoutValue = (pm: PayloadMetric): PayloadMetric => ({
    ...pm,
    stringValue: undefined,
    bytesValue: undefined,
    datasetValue: undefined,
    templateValue: undefined,
  });

  /**
   * Formats pm's value into rt within the value budget. A value over
   * MAX_VALUE_CHARS, one the backend's replay says it omitted, or one that
   * would take the connection past MAX_VALUE_CHARS_TOTAL is not kept: the
   * row shows its size and the message it came from has it.
   */
  const setValue = (rt: MetricRt, pm: PayloadMetric, omittedSize: number | undefined) => {
    let size = omittedSize;
    let formatted: { value: string; raw: string } | null = null;
    if (size === undefined) {
      // Measured in bytes, as the backend measures what it indexes, and
      // without formatting a huge string just to measure it.
      const wire = wireBytes(pm);
      if (wire > MAX_VALUE_CHARS) {
        size = wire;
      } else {
        formatted = formatMetricValue(pm, rt.datatype);
        const chars = formatted.value.length + formatted.raw.length;
        if (formatted.raw.length > MAX_VALUE_CHARS) size = formatted.raw.length;
        else if (valueChars - rt.chars + chars > MAX_VALUE_CHARS_TOTAL) size = chars;
      }
    }
    if (size !== undefined || formatted === null) {
      rt.source = withoutValue(pm);
      rt.omittedSize = size ?? 0;
      rt.value = `Not kept, ${formatSize(rt.omittedSize)}. Open the message for it.`;
      rt.valueRaw = "";
    } else {
      rt.source = pm;
      rt.omittedSize = undefined;
      rt.value = formatted.value;
      rt.valueRaw = formatted.raw;
    }
    const chars = rt.value.length + rt.valueRaw.length;
    valueChars += chars - rt.chars;
    rt.chars = chars;
  };

  const applyValue = (
    rt: MetricRt,
    pm: PayloadMetric,
    ord: number,
    m: mqtt.MqttMessage,
    payloadTs: string | number | undefined,
    omittedSize?: number
  ) => {
    rt.built = null;
    setValue(rt, pm, omittedSize);
    // Quality describes this value: a value published without one is not
    // still bad because an earlier one was.
    rt.qualityCode = readMetricProperties(pm).quality;
    rt.lastSeenOrd = ord;
    rt.lastSeenMs = m.timeMs;
    rt.payloadTsMs = parseTsMs(pm.timestamp, payloadTs);
    rt.topic = m.topic;
    rt.messageId = m.id as string | undefined;
    rt.isNull = pm.isNull;
    rt.isHistorical = pm.isHistorical;
    rt.isTransient = pm.isTransient;
  };

  /**
   * Takes the datatype and unit from the newest message that declares them,
   * whatever its value's age: a birth replayed after data still declares
   * what the data left out, and a newer birth corrects an older one.
   */
  const applyDeclarations = (rt: MetricRt, pm: PayloadMetric, ord: number) => {
    if (pm.datatype !== undefined && ord >= rt.datatypeOrd && pm.datatype !== rt.datatype) {
      rt.datatype = pm.datatype;
      rt.datatypeOrd = ord;
      if (rt.omittedSize === undefined) setValue(rt, rt.source, undefined);
      rt.built = null;
    } else if (pm.datatype !== undefined && ord >= rt.datatypeOrd) {
      rt.datatypeOrd = ord;
    }
    const unit = readMetricProperties(pm).unit;
    if (unit !== undefined && ord >= rt.unitOrd) {
      if (unit !== rt.unit) rt.built = null;
      rt.unit = unit;
      rt.unitOrd = ord;
    }
  };

  /** Drops a datatype or unit declared before ord (by a superseded birth). */
  const forgetDeclarationsBefore = (rt: MetricRt, ord: number) => {
    if (rt.datatypeOrd >= 0 && rt.datatypeOrd < ord) {
      rt.datatype = undefined;
      rt.datatypeOrd = -1;
      if (rt.omittedSize === undefined) setValue(rt, rt.source, undefined);
      rt.built = null;
    }
    if (rt.unitOrd >= 0 && rt.unitOrd < ord) {
      rt.unit = undefined;
      rt.unitOrd = -1;
      rt.built = null;
    }
  };

  /** Inserts or updates one metric. Never walks a value backwards. */
  const upsertMetric = (
    scope: ScopeRt,
    pm: PayloadMetric,
    ord: number,
    m: mqtt.MqttMessage,
    payloadTs: string | number | undefined,
    omitted?: Record<string, number>
  ) => {
    const name = metricKey(pm);
    const existing = scope.metrics.get(name);
    if (existing) {
      // Same order: a later sample of the metric in the same payload, which
      // wins, as it does in the backend's index.
      if (ord >= existing.lastSeenOrd) {
        applyDeclarations(existing, pm, ord);
        applyValue(existing, pm, ord, m, payloadTs, omitted?.[name]);
      } else {
        applyDeclarations(existing, pm, ord);
      }
      return;
    }
    const placeholder = pm.name === undefined || pm.name === "";
    if (placeholder && scope.placeholderCount >= MAX_PLACEHOLDER_METRICS) {
      warnCapOnce(
        "placeholder",
        `sparkplug-tree: placeholder metric cap reached (${MAX_PLACEHOLDER_METRICS}), ignoring new unresolved aliases`
      );
      return;
    }
    if (scope.metrics.size >= MAX_METRICS_PER_SCOPE || metricCount >= MAX_METRICS_TOTAL) {
      warnCapOnce(
        "metric",
        `sparkplug-tree: metric cap reached, ignoring new metrics`
      );
      return;
    }
    const rt: MetricRt = {
      name,
      placeholder,
      source: pm,
      datatypeOrd: -1,
      value: "",
      valueRaw: "",
      unitOrd: -1,
      lastSeenOrd: ord,
      lastSeenMs: m.timeMs,
      topic: m.topic,
      chars: 0,
      built: null,
    };
    applyDeclarations(rt, pm, ord);
    applyValue(rt, pm, ord, m, payloadTs, omitted?.[name]);
    scope.metrics.set(name, rt);
    scope.sortedKeys = null;
    metricCount++;
    if (placeholder) scope.placeholderCount++;
  };

  /**
   * Drops metrics older than a session boundary (a birth, or a death
   * followed by unbirthed data): they belong to the session it ended.
   */
  const dropMetricsOlderThan = (scope: ScopeRt, ord: number) => {
    for (const [key, m] of scope.metrics) {
      if (m.lastSeenOrd < ord) {
        scope.metrics.delete(key);
        scope.sortedKeys = null;
        metricCount--;
        valueChars -= m.chars;
        if (m.placeholder) scope.placeholderCount--;
      }
    }
  };

  /**
   * Data newer than a death with no birth between them is a new session
   * whose aliases nobody has told us; the dead session's metrics would sit
   * beside its alias placeholders and read as current. Retire them. Checked
   * from both sides, so it doesn't matter whether the death or the data is
   * folded first.
   */
  const recordDeath = (scope: ScopeRt, ord: number, timeMs: number) => {
    const list = scope.deathOrds;
    if (!list.includes(ord)) {
      let i = list.length;
      while (i > 0 && list[i - 1] > ord) i--;
      list.splice(i, 0, ord);
      if (list.length > DEATH_HISTORY_CAP) list.shift();
    }
    if (scope.deathOrd === undefined || ord > scope.deathOrd) {
      scope.deathOrd = ord;
      scope.deathAtMs = timeMs;
    }
  };

  /** Deaths that end a scope's sessions: a device's own and its node's. */
  const deathsOf = (scope: ScopeRt, node: NodeRt | null): number[] =>
    node === null || node === scope ? scope.deathOrds : [...scope.deathOrds, ...node.deathOrds];

  /**
   * Where the scope's current (unbirthed) session began: the newest death
   * after sessionStart that a sign of life followed. Everything before it
   * belongs to a session that death ended.
   */
  const restartBoundary = (deaths: number[], sessionStart: number | undefined, aliveOrd: number) => {
    let boundary: number | undefined;
    for (const d of deaths) {
      if (d < aliveOrd && (sessionStart === undefined || d > sessionStart) && (boundary === undefined || d > boundary)) {
        boundary = d;
      }
    }
    return boundary;
  };

  /** Some death falls strictly between lo and hi. */
  const deathBetween = (deaths: number[], lo: number, hi: number) => deaths.some((d) => d > lo && d < hi);

  const retireAfterUnbirthedRestart = (scope: ScopeRt, deaths: number[], sessionStart: number | undefined) => {
    const boundary = restartBoundary(deaths, sessionStart, scope.lastAliveOrd);
    if (boundary === undefined) return;
    dropMetricsOlderThan(scope, boundary);
    // What's left is from the new session, which declared nothing before
    // the death.
    for (const rt of scope.metrics.values()) forgetDeclarationsBefore(rt, boundary);
  };


  const recordSeqGap = (node: NodeRt, meta: SparkplugMeta, m: mqtt.MqttMessage, ord: number) => {
    const gap = meta.seqGap;
    if (!gap) return;
    if (node.lastSeqGapOrd === undefined || ord > node.lastSeqGapOrd) {
      node.lastSeqGapOrd = ord;
      node.lastSeqGap = { expected: gap.expected, got: gap.got };
    }
    // Two dedupes: by message id (the same message delivered twice, e.g. a
    // replay overlapping live traffic) and by content within a short window
    // either side (a publisher repeating the same gap), whatever the order.
    const id = m.id as string | undefined;
    if (id !== undefined) {
      if (warnedIds.has(id)) return;
      rememberWarnedId(id);
    }
    // Same gap in the same fixed window: one warning. Fixed windows rather
    // than "within 5s of the last one" so the count doesn't depend on the
    // order the repeats are folded in.
    const key = `${gap.expected}-${gap.got}-${Math.floor(m.timeMs / SEQ_GAP_DEDUPE_MS)}`;
    const repeat = node.seqGapKeys.get(key);
    if (repeat) {
      // The window's warning keeps its earliest time, whichever repeat
      // happened to be folded first.
      if (m.timeMs < repeat.timeMs && warnings.includes(repeat)) {
        repeat.timeMs = m.timeMs;
        sortWarnings();
      }
      return;
    }
    const w: SparkplugWarning = {
      group: node.group,
      node: node.name,
      text: `seq gap (expected ${gap.expected}, got ${gap.got})`,
      timeMs: m.timeMs,
      kind: "seq-gap",
    };
    node.seqGapKeys.set(key, w);
    if (node.seqGapKeys.size > 64) {
      const oldest = node.seqGapKeys.keys().next().value;
      if (oldest !== undefined) node.seqGapKeys.delete(oldest);
    }
    pushWarning(w);
  };

  const recordStorm = (node: NodeRt, m: mqtt.MqttMessage) => {
    // Only NBIRTHs count (a node birthing its devices at connect is normal;
    // repeated NBIRTHs are the classic duplicate-client-id symptom). Ring
    // entries carry the message id so a duplicate delivery of the same
    // NBIRTH cannot inflate the count, and stay sorted so a replayed birth
    // lands where it belongs.
    const id = m.id as string | undefined;
    if (id !== undefined && node.birthRing.some((b) => b.id === id)) return;
    const ring = node.birthRing;
    let i = ring.length;
    while (i > 0 && ring[i - 1].timeMs > m.timeMs) i--;
    ring.splice(i, 0, { id, timeMs: m.timeMs });
    if (ring.length > BIRTH_RING_CAP) ring.shift();

    const latest = ring[ring.length - 1].timeMs;
    let recent = 0;
    for (const b of ring) {
      if (latest - b.timeMs <= REBIRTH_STORM_WINDOW_MS) recent++;
    }
    if (recent >= REBIRTH_STORM_COUNT) {
      const text = `${recent} rebirths in 90s, possible duplicate client id`;
      const live = node.stormWarning;
      if (live && warnings.includes(live)) {
        // Ongoing storm: refresh its count and time in place (one warning
        // per node per storm).
        live.text = text;
        live.timeMs = latest;
        sortWarnings();
      } else {
        const w: SparkplugWarning = {
          group: node.group,
          node: node.name,
          text,
          timeMs: latest,
          kind: "rebirth-storm",
        };
        node.stormWarning = w;
        pushWarning(w);
      }
      stormNodes.add(node);
    } else if (m.timeMs === latest) {
      // Storm over: the next one gets a fresh warning.
      node.stormWarning = null;
    }
  };

  const noteAlive = (scope: ScopeRt, ord: number, timeMs: number) => {
    if (ord > scope.lastAliveOrd) {
      scope.lastAliveOrd = ord;
      scope.lastAliveMs = timeMs;
    }
  };

  const handleBirth = (meta: SparkplugMeta, m: mqtt.MqttMessage, ord: number) => {
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    if (!node) return;
    node.lastOrd = Math.max(node.lastOrd, ord);
    if (meta.staleBirth) return;
    node.dirty = true;
    const isDevice = meta.device !== undefined;
    const scope = isDevice ? ensureDevice(node, meta.device!) : node;
    if (!scope) return;

    if (!isDevice) recordStorm(node, m);
    noteAlive(scope, ord, m.timeMs);
    // A device can only birth through a live node.
    if (isDevice) noteAlive(node, ord, m.timeMs);
    recordSeqGap(node, meta, m, ord);

    if (!isDevice && (node.bdSeqOrd === undefined || ord > node.bdSeqOrd)) {
      // A birth without a bdSeq clears the previous session's.
      node.bdSeq = meta.bdSeq;
      node.bdSeqOrd = ord;
    }

    // While the view is hidden, births only count for liveness and storms;
    // the replay folds them properly when the view opens.
    if (!active) return;
    // A DBIRTH after the node's death means the node restarted.
    if (isDevice) retireAfterUnbirthedRestart(node, node.deathOrds, node.birthOrd);

    // A metric seen after a death that followed this birth belongs to a
    // later session this birth says nothing about.
    const deaths = deathsOf(scope, isDevice ? node : null);
    const fromLaterSession = (rt: MetricRt) => deathBetween(deaths, ord, rt.lastSeenOrd);

    // An older birth than the one already recorded belongs to a finished
    // session, and the newer birth governs every metric left: nothing it
    // says applies. So does a DBIRTH older than its node's latest NBIRTH.
    if (scope.birthOrd !== undefined && ord <= scope.birthOrd) return;
    if (isDevice && node.birthOrd !== undefined && ord < node.birthOrd) return;

    const payload = parsePayload(m);
    const payloadMetrics: PayloadMetric[] = payload?.metrics ?? [];

    // Replace, never merge: the birth defines the metric set. Anything newer
    // than it (live data folded in before this replayed birth) stays.
    dropMetricsOlderThan(scope, ord);
    for (const pm of payloadMetrics) {
      // bdSeq is session plumbing; it is surfaced on the node row instead of
      // polluting the metric list.
      if (pm.name === "bdSeq") continue;
      const existing = scope.metrics.get(metricKey(pm));
      if (existing && fromLaterSession(existing)) continue;
      upsertMetric(scope, pm, ord, m, payload?.timestamp);
    }
    // This birth is the newest declaration for every metric of its session:
    // what an older birth said about a type or unit goes, whether this birth
    // restates it or not. In arrival order this birth would have dropped
    // those rows, and the data after it would have made them afresh.
    for (const rt of scope.metrics.values()) {
      if (!fromLaterSession(rt)) forgetDeclarationsBefore(rt, ord);
    }
    scope.birthOrd = ord;
    scope.birthAtMs = m.timeMs;
    // Folded after the death that ended it and a restart that followed:
    // what it just added is as retired as it would be in arrival order.
    retireAfterUnbirthedRestart(scope, deaths, ord);

    if (!isDevice) {
      // Every device's session ends with its node's: until a fresh DBIRTH,
      // its old metrics are from a finished session, and what an older
      // DBIRTH declared no longer holds.
      for (const device of node.devices.values()) {
        dropMetricsOlderThan(device, ord);
        for (const rt of device.metrics.values()) forgetDeclarationsBefore(rt, ord);
      }
    }
  };

  const handleData = (meta: SparkplugMeta, m: mqtt.MqttMessage, ord: number) => {
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    if (!node) return;
    node.lastOrd = Math.max(node.lastOrd, ord);
    node.dirty = true;
    const isDevice = meta.device !== undefined;
    const scope = isDevice ? ensureDevice(node, meta.device!) : node;
    if (!scope) return;

    noteAlive(scope, ord, m.timeMs);
    if (isDevice) noteAlive(node, ord, m.timeMs);
    recordSeqGap(node, meta, m, ord);
    if (meta.carriedOver) scope.carriedOverOrd = newest(scope.carriedOverOrd, ord);

    // While the view is hidden, values are left to the replay.
    if (!active) return;
    // Device data after the node's death means the node restarted, whether
    // or not this data is still current for its device.
    if (isDevice) retireAfterUnbirthedRestart(node, node.deathOrds, node.birthOrd);

    // Data from before the scope's current session started is superseded by
    // the birth that started it.
    const sessionStart = isDevice ? newest(node.birthOrd, scope.birthOrd) : scope.birthOrd;
    if (sessionStart !== undefined && ord < sessionStart) return;
    // So is data from before a death that a newer, unbirthed session
    // followed: folded in arrival order the restart would have retired it.
    const deaths = deathsOf(scope, isDevice ? node : null);
    const boundary = restartBoundary(deaths, sessionStart, scope.lastAliveOrd);
    if (boundary !== undefined && ord < boundary) return;
    retireAfterUnbirthedRestart(scope, deaths, sessionStart);

    const payload = parsePayload(m);
    const payloadMetrics: PayloadMetric[] = payload?.metrics ?? [];
    for (const pm of payloadMetrics) {
      upsertMetric(scope, pm, ord, m, payload?.timestamp, meta.omitted);
    }
  };

  const handleDeath = (meta: SparkplugMeta, m: mqtt.MqttMessage, ord: number) => {
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    if (!node) return;
    node.lastOrd = Math.max(node.lastOrd, ord);
    // A death whose bdSeq does not match the live birth belongs to a
    // superseded session: it says nothing about the session on screen.
    if (meta.staleDeath) return;
    node.dirty = true;
    recordSeqGap(node, meta, m, ord);
    if (meta.device !== undefined) {
      const device = ensureDevice(node, meta.device);
      if (!device) return;
      recordDeath(device, ord, m.timeMs);
      if (active) {
        retireAfterUnbirthedRestart(device, deathsOf(device, node), newest(node.birthOrd, device.birthOrd));
      }
      return;
    }
    recordDeath(node, ord, m.timeMs);
    if (meta.bdSeq !== undefined && (node.bdSeqOrd === undefined || ord > node.bdSeqOrd)) {
      node.bdSeq = meta.bdSeq;
      node.bdSeqOrd = ord;
    }
    if (active) {
      retireAfterUnbirthedRestart(node, node.deathOrds, node.birthOrd);
      for (const device of node.devices.values()) {
        retireAfterUnbirthedRestart(device, deathsOf(device, node), newest(node.birthOrd, device.birthOrd));
      }
    }
  };

  const handleState = (meta: SparkplugMeta, m: mqtt.MqttMessage, ord: number) => {
    const hostId = meta.hostId ?? "";
    if (hostId === "") return;
    const existing = hosts.get(hostId);
    if (existing && existing.atOrd >= ord) return; // older or the same
    if (!existing && hosts.size >= MAX_TRACKED_HOSTS) {
      warnCapOnce(
        "host",
        `sparkplug-tree: host cap reached (${MAX_TRACKED_HOSTS}), ignoring new STATE hosts`
      );
      return;
    }
    let text: string;
    try {
      text = base64ToText(m.payload as unknown as string);
    } catch {
      return;
    }
    // Sparkplug 3.0 form: JSON {"online":bool,"timestamp":ms}.
    try {
      const parsed = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object" && "online" in parsed) {
        const ts = Number(parsed.timestamp);
        hosts.set(hostId, {
          online: !!parsed.online,
          sinceMs: Number.isFinite(ts) && ts > 0 ? ts : m.timeMs,
          atOrd: ord,
        });
        return;
      }
    } catch {
      // fall through to the legacy form
    }
    // Legacy 2.2 form: plain ONLINE / OFFLINE.
    const trimmed = text.trim().toUpperCase();
    if (trimmed === "ONLINE" || trimmed === "OFFLINE") {
      hosts.set(hostId, { online: trimmed === "ONLINE", sinceMs: m.timeMs, atOrd: ord });
    }
    // Anything else is junk on the STATE topic: ignore silently.
  };

  /** Folds one enriched message in. Returns true when state changed. */
  const processMessage = (m: mqtt.MqttMessage): boolean => {
    const meta = (m.middlewareProperties as any)?.sparkplug as
      | SparkplugMeta
      | undefined;
    if (!meta) return false; // cheap early exit for non-Sparkplug traffic
    const ord = typeof meta.n === "number" ? meta.n : m.timeMs;
    if (ord > maxOrdSeen) maxOrdSeen = ord;
    if (m.timeMs > maxTimeSeen) maxTimeSeen = m.timeMs;
    switch (meta.msgType) {
      case "NBIRTH":
      case "DBIRTH":
        hasSparkplug = true;
        handleBirth(meta, m, ord);
        break;
      case "NDATA":
      case "DDATA":
        hasSparkplug = true;
        handleData(meta, m, ord);
        break;
      case "NDEATH":
      case "DDEATH":
        hasSparkplug = true;
        handleDeath(meta, m, ord);
        break;
      case "STATE":
        // The legacy STATE/<host> form matches any two-level topic under a
        // root called STATE, so on its own it doesn't prove this connection
        // carries Sparkplug; the 3.0 form lives in the namespace and does.
        if (m.topic.startsWith("spBv1.0/")) hasSparkplug = true;
        // Hosts only show in the open view, and its replay brings them.
        if (active) handleState(meta, m, ord);
        break;
      default:
        // NCMD/DCMD (and unknown types): traffic exists but carries no tree
        // state we track.
        hasSparkplug = true;
        break;
    }
    return true;
  };

  const ingest = (messages: mqtt.MqttMessage[]): boolean => {
    let changed = false;
    for (const m of messages) {
      if (processMessage(m)) changed = true;
    }
    return changed;
  };

  // --- Ticker (relative last-seen labels) -------------------------------------

  let tickerId: ReturnType<typeof setInterval> | null = null;
  const tick = () => {
    // Ages only show in the open view.
    if (active && (groups.size > 0 || hosts.size > 0)) flush();
  };
  const startTicker = () => {
    if (destroyed) return;
    if (tickerId === null) tickerId = setInterval(tick, TICKER_MS);
  };
  const stopTicker = () => {
    if (tickerId !== null) {
      clearInterval(tickerId);
      tickerId = null;
    }
  };

  // --- Reset / listeners / lifecycle ------------------------------------------

  const resetData = () => {
    groups.clear();
    hosts.clear();
    warnings = [];
    warnedIds.clear();
    nodeCount = 0;
    metricCount = 0;
    valueChars = 0;
    structureChanged = true;
    lastGroupByName.clear();
    lastGroups = [];
    stormNodes.clear();
    dataEpoch++;
  };

  const onConnectionDown = () => {
    if (connected) {
      // After everything received so far, before anything that follows.
      droppedAtOrd = maxOrdSeen + 0.5;
      droppedAtMs = Date.now();
    }
    connected = false;
    stopTicker();
    markAllDirty();
    flush();
  };

  let offMessages: (() => void) | null = null;
  let offClear: (() => void) | null = null;
  let offConnected: (() => void) | null = null;
  let offDisconnected: (() => void) | null = null;
  let offReconnecting: (() => void) | null = null;

  const bindListeners = () => {
    offMessages = Events.On(eventSet.mqttMessages, (e: any) => {
      const messages: mqtt.MqttMessage[] = e.data ?? [];
      // One coalesced store write per batch, and none at all for batches with
      // no Sparkplug traffic. Live traffic is never held back for a replay:
      // folding is order-independent and warning counters dedupe by message
      // id, so the replay can land before or after this batch.
      if (!ingest(messages)) return;
      clearIdleBackfillTimer();
      flush();
    });
    // Clearing history clears the traffic, not the session: the backend
    // keeps every scope's birth and death, so an open view rebuilds from
    // them (names, types and birth values stay). The view stays offered.
    offClear = Events.On(eventSet.mqttClearHistory, () => {
      resetData();
      if (active) void replay();
      else flush();
    });
    offConnected = Events.On(eventSet.mqttConnected, () => {
      connected = true;
      startTicker();
      markAllDirty();
      flush();
      // Messages received just before a drop can still be delivered after
      // the reconnect. The backend knows where the drop fell in its order;
      // anything before it is no sign of life since.
      GetSparkplugSuspendedOrd(connectionId)
        .then((suspended) => {
          if (destroyed || !suspended) return;
          const drop = suspended + 0.5;
          if (droppedAtOrd === undefined || drop > droppedAtOrd) {
            droppedAtOrd = drop;
            markAllDirty();
            flush();
          }
        })
        .catch((e) => console.warn("sparkplug-tree: drop position fetch failed", e));
    });
    // A drop and a deliberate disconnect are the same to the tree: nothing
    // can be known about what happens while away, so the tree keeps its last
    // values and marks everything as not heard from since.
    offDisconnected = Events.On(eventSet.mqttDisconnected, onConnectionDown);
    offReconnecting = Events.On(eventSet.mqttReconnecting, onConnectionDown);
  };

  // Folds the backend's snapshot of the session: every scope's latest birth
  // and death, the latest value of every metric, recent warnings and host
  // STATE. Live traffic keeps flowing while it is in flight; folding is
  // order-independent. Guarded by dataEpoch against a clear racing the fetch.
  // A big replay is folded in chunks, yielding to the renderer between them.
  let replayPromise: Promise<void> | null = null;
  let replayToken: object | null = null;
  let replayEpoch = -1;
  let replayForView = false;
  const replay = (): Promise<void> => {
    // An idle replay started while the view was hidden took its snapshot
    // before anything received since, which the hidden view didn't fold. An
    // opening view needs its own.
    if (replayPromise && replayEpoch === dataEpoch && (replayForView || !active)) {
      return replayPromise;
    }
    const token = {};
    replayToken = token;
    const epoch = dataEpoch;
    replayEpoch = epoch;
    replayForView = active;
    // Only an open view shows the loading state; the idle replay for a
    // hidden one stays silent unless it finds something.
    const showsProgress = active;
    let changed = false;
    replaying = true;
    if (showsProgress) flush();
    const stale = () => destroyed || epoch !== dataEpoch;
    const promise = (async () => {
      try {
        const history = (await GetSparkplugMessageHistory(connectionId)) as unknown as
          | SparkplugHistory
          | null;
        if (stale()) return;
        if (history?.suspendedOrd) {
          // The backend saw a drop, possibly before this store existed.
          droppedAtOrd = newest(droppedAtOrd, history.suspendedOrd + 0.5);
        }
        const messages = history?.messages ?? [];
        let start = 0;
        let chars = 0;
        for (let i = 0; i < messages.length; i++) {
          chars += (messages[i].payload as unknown as string)?.length ?? 0;
          if (chars < REPLAY_CHUNK_CHARS && i < messages.length - 1) continue;
          if (ingest(messages.slice(start, i + 1))) changed = true;
          start = i + 1;
          chars = 0;
          if (start < messages.length) {
            await yieldToMain();
            if (stale()) return;
          }
        }
        markAllDirty();
      } catch (e) {
        console.error("sparkplug-tree: history replay failed", e);
      } finally {
        if (replayToken === token) {
          replaying = false;
          replayPromise = null;
          replayToken = null;
        }
        if (!destroyed && (showsProgress || changed || active)) flush();
      }
    })();
    if (replayToken === token) replayPromise = promise;
    return promise;
  };

  const clearIdleBackfillTimer = () => {
    if (idleBackfillTimer !== null) {
      clearTimeout(idleBackfillTimer);
      idleBackfillTimer = null;
    }
  };

  /**
   * Shows or hides the tree. Showing it replays the backend's snapshot, so
   * the tree is complete however long the view was hidden; hiding it stops
   * decoding payloads and building the tree.
   */
  const setActive = (next: boolean): Promise<void> => {
    if (next === active) return replayPromise ?? Promise.resolve();
    active = next;
    if (!active) {
      flush();
      return Promise.resolve();
    }
    markAllDirty();
    structureChanged = true;
    return replay();
  };

  /**
   * Acknowledges the warnings: empties the list and the toggle's count.
   * Node state (a seq gap until the next birth) is not a warning and stays.
   */
  const clearWarnings = () => {
    for (const node of stormNodes) {
      node.stormWarning = null;
      node.dirty = true;
    }
    stormNodes.clear();
    for (const nodes of groups.values()) {
      for (const node of nodes.values()) node.stormWarning = null;
    }
    warnings = [];
    flush();
  };

  /** Opens the view (kept for callers that only ever show it). */
  const activate = (): Promise<void> => setActive(true);

  // Binds the live listeners only. The idle timer covers a dormant
  // connection whose Sparkplug traffic stopped before this mount: with no
  // live message to say Sparkplug is here, the replay does.
  const init = () => {
    bindListeners();
    if (connected) startTicker();
    idleBackfillTimer = setTimeout(() => {
      idleBackfillTimer = null;
      if (!hasSparkplug && !idleBackfillDone) {
        idleBackfillDone = true;
        void replay();
      }
    }, BACKFILL_IDLE_MS);
    flush();
  };

  const destroy = () => {
    destroyed = true;
    offMessages?.();
    offClear?.();
    offConnected?.();
    offDisconnected?.();
    offReconnecting?.();
    offMessages = offClear = offConnected = offDisconnected = null;
    offReconnecting = null;
    clearIdleBackfillTimer();
    stopTicker();
  };

  return {
    subscribe,
    init,
    activate,
    setActive,
    clearWarnings,
    destroy,
    /** Test/inspection helper: current state snapshot. */
    snapshot: () => get({ subscribe }),
    connectionId,
  };
};
