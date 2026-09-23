// Data store for the Sparkplug session tree (the Sparkplug view of the data
// panel). It folds the backend's already-enriched Sparkplug messages (the
// middlewareProperties["sparkplug"] meta plus name-injected protojson
// payloads) into a live group -> edge node -> device -> metric inventory with
// health diagnostics: seq-gap flags, rebirth-storm warnings and host STATE
// tracking. See docs/specs/research/stateful-sparkplug-decode.md.
//
// Order independence. Live batches and the history replay can interleave in
// any order, so nothing here depends on arrival order. Every scope keeps the
// newest time of each kind of signal (birth, data, death, seq gap) and the
// visible state is derived from those: a node is online when its newest sign
// of life is newer than its newest death, a birth only replaces metrics that
// are older than it, a seq gap only counts when it is newer than the birth,
// and data older than the scope's birth belongs to a finished session and is
// ignored. Replaying the same messages in any order lands on the same tree.
//
// Connection drops. Nothing the client missed while disconnected can be
// known: a node may have died, or rebirthed with new aliases. So on a drop the
// tree keeps its last values, but status only counts signals received after
// the drop (unknown until a node is heard from again) and names from births
// before it are flagged unverified until the node births again. The backend
// flags the same messages with carriedOver.
//
// Performance contract (mirrors broker-status-store):
//   - The all-messages feed does a cheap early exit per message: anything
//     without sparkplug middleware meta costs one property read, no allocs.
//   - Svelte store writes are coalesced: at most one `set` per incoming batch
//     event and one per 1 s ticker tick, never per message.
//   - Snapshots are incremental: only nodes touched since the last snapshot
//     are rebuilt; everything else reuses the previous objects.
//   - State is bounded by hard caps, not by traffic: MAX_TRACKED_NODES nodes,
//     MAX_TRACKED_DEVICES devices per node, MAX_METRICS_PER_SCOPE metrics and
//     MAX_PLACEHOLDER_METRICS alias placeholders per scope (these mirror the
//     backend session caps), MAX_TRACKED_HOSTS hosts, warnings at WARNING_CAP
//     and the per-node birth ring at BIRTH_RING_CAP. Over-cap keys are
//     dropped, with one console.warn per store per cap kind.
//   - The history backfill is deferred and single-shot: it runs on the first
//     live Sparkplug message, on activate() (the user opening the view), or on
//     an idle fallback timer, never unconditionally on every panel mount.

import { get, writable } from "svelte/store";
import { Events } from "@wailsio/runtime";
import type * as events from "bindings/mqtt-viewer/events/models";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import { GetSparkplugMessageHistory } from "bindings/mqtt-viewer/backend/app/app";
import {
  datatypeName,
  formatMetricValue,
  qualityLabel,
  readMetricProperties,
  type PayloadMetric,
} from "./sparkplug-values";

export { datatypeName } from "./sparkplug-values";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

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
/** Consecutive identical seq-gap warnings within this window are deduped. */
export const SEQ_GAP_DEDUPE_MS = 5_000;
/** Ticker cadence for relative last-seen labels. */
export const TICKER_MS = 1000;
/** Total edge nodes tracked across all groups (mirrors the backend cap). */
export const MAX_TRACKED_NODES = 4096;
/** Devices tracked per edge node (mirrors the backend cap). */
export const MAX_TRACKED_DEVICES = 1024;
/** Metrics kept per node or device (mirrors the backend replay index cap). */
export const MAX_METRICS_PER_SCOPE = 4096;
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
  /** Topic of the message that last updated this metric. */
  topic: string;
  isNull?: boolean;
  isHistorical?: boolean;
  isTransient?: boolean;
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
  /** The payload metric the value came from, kept to re-format it if the
   *  datatype is only learned later (an older birth replayed after data). */
  source: PayloadMetric;
  datatype?: number;
  value: string;
  valueRaw: string;
  unit?: string;
  qualityCode?: number;
  lastSeenMs: number;
  payloadTsMs?: number;
  topic: string;
  isNull?: boolean;
  isHistorical?: boolean;
  isTransient?: boolean;
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
  /** Arrival time of the newest birth folded into this scope. */
  birthAtMs?: number;
  /** Newest birth or data arrival. */
  lastAliveMs: number;
  /** Newest death arrival. */
  deathAtMs?: number;
  /**
   * Newest data the backend flagged carriedOver: names resolved from a birth
   * that predates a connection drop, possibly before this store existed.
   */
  carriedOverAtMs?: number;
}

type DeviceRt = ScopeRt;

interface NodeRt extends ScopeRt {
  group: string;
  bdSeq?: number;
  /** bdSeq came from the newest birth or death folded in so far. */
  bdSeqAtMs?: number;
  lastSeqGap?: { expected: number; got: number };
  lastSeqGapMs?: number;
  /** NBIRTH arrivals (capped), sorted ascending, for storm detection. */
  birthRing: { id?: string; timeMs: number }[];
  /** The storm warning currently attached to this node, if a storm is live. */
  stormWarning: SparkplugWarning | null;
  lastSeqGapWarning: { expected: number; got: number; timeMs: number } | null;
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
  /**
   * Set by the backend when an NDEATH's bdSeq does not match the live
   * session's birth: a late death from a superseded session, which must not
   * take the current session offline.
   */
  staleDeath?: boolean;
}

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

export const createSparkplugTreeStore = (
  connectionId: number,
  eventSet: events.ConnectionEventsSet,
  opts: { connected?: boolean } = {}
) => {
  // group name -> (edge node name -> node runtime)
  const groups = new Map<string, Map<string, NodeRt>>();
  const hosts = new Map<string, { online: boolean; sinceMs: number; atMs: number }>();
  let warnings: SparkplugWarning[] = [];
  let hasSparkplug = false;

  let connected = opts.connected ?? true;
  // The last time the connection went down. Status and name verification
  // only trust signals newer than this. A store created while disconnected
  // starts from "down since now": anything it replays is from before.
  let droppedAtMs: number | undefined = connected ? undefined : Date.now();

  // Bumped on clear-history so an in-flight backfill can't resurrect state.
  let dataEpoch = 0;

  // Set by destroy(); guards against init()'s backfill continuation running
  // (and leaking a ticker) after the store has been torn down.
  let destroyed = false;

  // Single-shot guard for the deferred backfill, plus its idle fallback timer.
  let backfillStarted = false;
  let backfillPromise: Promise<void> | null = null;
  let idleBackfillTimer: ReturnType<typeof setTimeout> | null = null;

  // Total nodes across all groups, kept as a counter so the cap check never
  // walks the group maps on the hot path.
  let nodeCount = 0;
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

  /** Returns null when the node is new and the tracking cap is reached. */
  const ensureNode = (group: string, name: string): NodeRt | null => {
    let nodes = groups.get(group);
    let node = nodes?.get(name);
    if (node) return node;
    if (nodeCount >= MAX_TRACKED_NODES) {
      warnCapOnce(
        "node",
        `sparkplug-tree: node cap reached (${MAX_TRACKED_NODES}), ignoring new edge nodes`
      );
      return null;
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
      lastAliveMs: 0,
      birthRing: [],
      stormWarning: null,
      lastSeqGapWarning: null,
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
        lastAliveMs: 0,
      };
      node.devices.set(name, device);
    }
    return device;
  };

  const pushWarning = (w: SparkplugWarning) => {
    warnings.push(w);
    if (warnings.length > WARNING_CAP) warnings.shift();
  };

  // Message ids already counted towards a warning. Warning counting is
  // frontend-side, so a duplicate delivery (a replay overlapping live
  // traffic) would otherwise double count. Insertion-ordered Set used as a
  // bounded FIFO.
  const warnedIds = new Set<string>();
  const rememberWarnedId = (id: string) => {
    warnedIds.add(id);
    if (warnedIds.size > WARNED_ID_CAP) {
      const oldest = warnedIds.values().next().value;
      if (oldest !== undefined) warnedIds.delete(oldest);
    }
  };

  // --- Derived state ----------------------------------------------------------

  /** Newest time >= the last drop, or undefined when older or missing. */
  const sinceDrop = (t: number | undefined): number | undefined => {
    if (t === undefined || t <= 0) return undefined;
    if (droppedAtMs !== undefined && t < droppedAtMs) return undefined;
    return t;
  };

  const statusOf = (aliveMs: number, deathMs: number | undefined): SparkplugStatus => {
    if (!connected) return "unknown";
    const alive = sinceDrop(aliveMs);
    const dead = sinceDrop(deathMs);
    if (alive === undefined && dead === undefined) return "unknown";
    if (dead === undefined) return "online";
    if (alive === undefined) return "offline";
    return alive > dead ? "online" : "offline";
  };

  const isVerified = (scope: ScopeRt) =>
    scope.birthAtMs !== undefined &&
    (droppedAtMs === undefined || scope.birthAtMs >= droppedAtMs) &&
    (scope.carriedOverAtMs === undefined || scope.birthAtMs > scope.carriedOverAtMs);

  /** Newest of two optional times. */
  const newest = (a: number | undefined, b: number | undefined) =>
    a === undefined ? b : b === undefined ? a : Math.max(a, b);

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
    isNull: rt.isNull,
    isHistorical: rt.isHistorical,
    isTransient: rt.isTransient,
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

  /** A node's birth is current (not ended by a newer death). */
  const hasLiveBirth = (scope: ScopeRt) =>
    scope.birthAtMs !== undefined &&
    (scope.deathAtMs === undefined || scope.birthAtMs > scope.deathAtMs);

  const buildNode = (n: NodeRt): SparkplugNode => {
    const devices: SparkplugDevice[] = [];
    for (const dName of Array.from(n.devices.keys()).sort()) {
      const d = n.devices.get(dName)!;
      // A node's death takes its devices with it.
      const deviceDeath = newest(d.deathAtMs, n.deathAtMs);
      const awaitingBirth =
        n.birthAtMs !== undefined &&
        (d.birthAtMs === undefined || d.birthAtMs < n.birthAtMs) &&
        d.metrics.size === 0;
      const deviceHasBirth =
        d.birthAtMs !== undefined &&
        (deviceDeath === undefined || d.birthAtMs > deviceDeath) &&
        (n.birthAtMs === undefined || d.birthAtMs >= n.birthAtMs);
      const status = statusOf(d.lastAliveMs, deviceDeath);
      devices.push({
        name: d.name,
        status,
        online: status === "online",
        hasBirth: deviceHasBirth,
        birthAtMs: d.birthAtMs,
        verified: deviceHasBirth && isVerified(d),
        metrics: buildMetrics(d),
        lastSeenMs: d.lastAliveMs,
        deathAtMs: deviceDeath,
        placeholderCount: d.placeholderCount,
        awaitingBirth,
      });
    }
    const status = statusOf(n.lastAliveMs, n.deathAtMs);
    const nodeHasBirth = hasLiveBirth(n);
    const seqOk =
      n.lastSeqGapMs === undefined ||
      (n.birthAtMs !== undefined && n.birthAtMs > n.lastSeqGapMs);
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
      storm: n.stormWarning !== null && warnings.includes(n.stormWarning),
    };
  };

  const buildState = (): SparkplugTreeState => {
    const nowMs = connected || droppedAtMs === undefined ? Date.now() : droppedAtMs;
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

    const outHosts: SparkplugHost[] = [];
    for (const hostId of Array.from(hosts.keys()).sort()) {
      const h = hosts.get(hostId)!;
      outHosts.push({ hostId, online: h.online, sinceMs: h.sinceMs });
    }
    return {
      hasSparkplug,
      connected,
      droppedAtMs,
      hosts: outHosts,
      groups: lastGroups,
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

  const applyMetric = (
    rt: MetricRt,
    pm: PayloadMetric,
    arrivalMs: number,
    payloadTs: string | number | undefined,
    topic: string
  ) => {
    if (pm.datatype !== undefined) rt.datatype = pm.datatype;
    rt.built = null;
    rt.source = pm;
    const { value, raw } = formatMetricValue(pm, rt.datatype);
    rt.value = value;
    rt.valueRaw = raw;
    // Properties usually ride on the birth only; a data message without them
    // keeps what the birth declared.
    const props = readMetricProperties(pm);
    if (props.unit !== undefined) rt.unit = props.unit;
    if (props.quality !== undefined) rt.qualityCode = props.quality;
    rt.lastSeenMs = arrivalMs;
    rt.payloadTsMs = parseTsMs(pm.timestamp, payloadTs);
    rt.topic = topic;
    rt.isNull = pm.isNull;
    rt.isHistorical = pm.isHistorical;
    rt.isTransient = pm.isTransient;
  };

  /** Inserts or updates one metric. Never walks a metric backwards in time. */
  const upsertMetric = (
    scope: ScopeRt,
    pm: PayloadMetric,
    arrivalMs: number,
    payloadTs: string | number | undefined,
    topic: string
  ) => {
    const name = metricKey(pm);
    const existing = scope.metrics.get(name);
    if (existing) {
      if (arrivalMs < existing.lastSeenMs) {
        // An older message never changes the value, but a birth replayed
        // after newer data still declares what the data left out.
        if (existing.datatype === undefined && pm.datatype !== undefined) {
          existing.built = null;
          existing.datatype = pm.datatype;
          const { value, raw } = formatMetricValue(existing.source, pm.datatype);
          existing.value = value;
          existing.valueRaw = raw;
        }
        if (existing.unit === undefined) {
          const unit = readMetricProperties(pm).unit;
          if (unit !== undefined) {
            existing.built = null;
            existing.unit = unit;
          }
        }
        return;
      }
      applyMetric(existing, pm, arrivalMs, payloadTs, topic);
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
    if (scope.metrics.size >= MAX_METRICS_PER_SCOPE) {
      warnCapOnce(
        "metric",
        `sparkplug-tree: metric cap reached (${MAX_METRICS_PER_SCOPE}) on a node or device, ignoring new metrics`
      );
      return;
    }
    const rt: MetricRt = {
      name,
      placeholder,
      source: pm,
      value: "",
      valueRaw: "",
      lastSeenMs: arrivalMs,
      topic,
      built: null,
    };
    applyMetric(rt, pm, arrivalMs, payloadTs, topic);
    scope.metrics.set(name, rt);
    scope.sortedKeys = null;
    if (placeholder) scope.placeholderCount++;
  };

  /**
   * Drops metrics older than a birth at `birthMs`: they belong to the session
   * the birth ended. Newer ones (folded in before an older replayed birth)
   * stay.
   */
  const dropMetricsOlderThan = (scope: ScopeRt, birthMs: number) => {
    for (const [key, m] of scope.metrics) {
      if (m.lastSeenMs < birthMs) {
        scope.metrics.delete(key);
        scope.sortedKeys = null;
        if (m.placeholder) scope.placeholderCount--;
      }
    }
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
    } else if (m.timeMs === latest) {
      // Storm over: the next one gets a fresh warning.
      node.stormWarning = null;
    }
  };

  const handleBirth = (meta: SparkplugMeta, m: mqtt.MqttMessage) => {
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    if (!node) return;
    node.dirty = true;
    const isDevice = meta.device !== undefined;
    const scope = isDevice ? ensureDevice(node, meta.device!) : node;
    if (!scope) return;

    if (!isDevice) recordStorm(node, m);
    if (m.timeMs > scope.lastAliveMs) scope.lastAliveMs = m.timeMs;

    // An older birth than the one already recorded belongs to a finished
    // session. So does a DBIRTH older than its node's latest NBIRTH.
    if (scope.birthAtMs !== undefined && m.timeMs < scope.birthAtMs) return;
    if (isDevice && node.birthAtMs !== undefined && m.timeMs < node.birthAtMs) return;

    const payload = parsePayload(m);
    const payloadMetrics: PayloadMetric[] = payload?.metrics ?? [];

    // Replace, never merge: the birth defines the metric set. Anything newer
    // than it (live data folded in before this replayed birth) stays.
    dropMetricsOlderThan(scope, m.timeMs);
    for (const pm of payloadMetrics) {
      // bdSeq is session plumbing; it is surfaced on the node row instead of
      // polluting the metric list.
      if (pm.name === "bdSeq") continue;
      upsertMetric(scope, pm, m.timeMs, payload?.timestamp, m.topic);
    }
    scope.birthAtMs = m.timeMs;

    if (!isDevice) {
      if (meta.bdSeq !== undefined && (node.bdSeqAtMs ?? 0) <= m.timeMs) {
        node.bdSeq = meta.bdSeq;
        node.bdSeqAtMs = m.timeMs;
      }
      // Every device's session ends with its node's: until a fresh DBIRTH,
      // its old metrics are from a finished session.
      for (const device of node.devices.values()) {
        dropMetricsOlderThan(device, m.timeMs);
      }
    }
  };

  const handleData = (meta: SparkplugMeta, m: mqtt.MqttMessage) => {
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    if (!node) return;
    node.dirty = true;
    const isDevice = meta.device !== undefined;
    const scope = isDevice ? ensureDevice(node, meta.device!) : node;
    if (!scope) return;

    if (m.timeMs > scope.lastAliveMs) scope.lastAliveMs = m.timeMs;
    if (isDevice && m.timeMs > node.lastAliveMs) node.lastAliveMs = m.timeMs;

    // Data from before the scope's current session started is superseded by
    // the birth that started it.
    const sessionStart = isDevice
      ? newest(node.birthAtMs, scope.birthAtMs)
      : scope.birthAtMs;
    if (meta.carriedOver) {
      scope.carriedOverAtMs = newest(scope.carriedOverAtMs, m.timeMs);
    }
    if (sessionStart === undefined || m.timeMs >= sessionStart) {
      // Data after a death with no birth since is a new session whose
      // aliases nobody has told us: the dead session's named metrics would
      // sit beside its alias placeholders and read as current. Retire them.
      const scopeDeath = isDevice ? newest(scope.deathAtMs, node.deathAtMs) : scope.deathAtMs;
      if (
        scopeDeath !== undefined &&
        m.timeMs > scopeDeath &&
        (sessionStart === undefined || scopeDeath > sessionStart)
      ) {
        dropMetricsOlderThan(scope, scopeDeath);
      }
      const payload = parsePayload(m);
      const payloadMetrics: PayloadMetric[] = payload?.metrics ?? [];
      for (const pm of payloadMetrics) {
        upsertMetric(scope, pm, m.timeMs, payload?.timestamp, m.topic);
      }
    }

    const gap = meta.seqGap;
    if (gap) {
      if (node.lastSeqGapMs === undefined || m.timeMs >= node.lastSeqGapMs) {
        node.lastSeqGapMs = m.timeMs;
        node.lastSeqGap = { expected: gap.expected, got: gap.got };
      }
      const prev = node.lastSeqGapWarning;
      // Two dedupes: by message id (the same message delivered twice, e.g. a
      // replay overlapping live traffic) and by content within a short window
      // (a publisher repeating the same gap).
      const id = m.id as string | undefined;
      const isDuplicate =
        (id !== undefined && warnedIds.has(id)) ||
        (prev !== null &&
          prev.expected === gap.expected &&
          prev.got === gap.got &&
          Math.abs(m.timeMs - prev.timeMs) <= SEQ_GAP_DEDUPE_MS);
      if (id !== undefined) rememberWarnedId(id);
      if (!isDuplicate) {
        pushWarning({
          group: node.group,
          node: node.name,
          text: `seq gap (expected ${gap.expected}, got ${gap.got})`,
          timeMs: m.timeMs,
          kind: "seq-gap",
        });
      }
      node.lastSeqGapWarning = {
        expected: gap.expected,
        got: gap.got,
        timeMs: m.timeMs,
      };
    }
  };

  const handleDeath = (meta: SparkplugMeta, m: mqtt.MqttMessage) => {
    // A death whose bdSeq does not match the live birth belongs to a
    // superseded session: it says nothing about the session on screen.
    if (meta.staleDeath) return;
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    if (!node) return;
    node.dirty = true;
    if (meta.device !== undefined) {
      const device = ensureDevice(node, meta.device);
      if (!device) return;
      device.deathAtMs = newest(device.deathAtMs, m.timeMs);
      return;
    }
    node.deathAtMs = newest(node.deathAtMs, m.timeMs);
    if (meta.bdSeq !== undefined && (node.bdSeqAtMs ?? 0) <= m.timeMs) {
      node.bdSeq = meta.bdSeq;
      node.bdSeqAtMs = m.timeMs;
    }
  };

  const handleState = (meta: SparkplugMeta, m: mqtt.MqttMessage) => {
    const hostId = meta.hostId ?? "";
    if (hostId === "") return;
    const existing = hosts.get(hostId);
    if (existing && existing.atMs > m.timeMs) return; // older replay
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
          atMs: m.timeMs,
        });
        return;
      }
    } catch {
      // fall through to the legacy form
    }
    // Legacy 2.2 form: plain ONLINE / OFFLINE.
    const trimmed = text.trim().toUpperCase();
    if (trimmed === "ONLINE" || trimmed === "OFFLINE") {
      hosts.set(hostId, {
        online: trimmed === "ONLINE",
        sinceMs: m.timeMs,
        atMs: m.timeMs,
      });
    }
    // Anything else is junk on the STATE topic: ignore silently.
  };

  /** Folds one enriched message in. Returns true when state changed. */
  const processMessage = (m: mqtt.MqttMessage): boolean => {
    const meta = (m.middlewareProperties as any)?.sparkplug as
      | SparkplugMeta
      | undefined;
    if (!meta) return false; // cheap early exit for non-Sparkplug traffic
    hasSparkplug = true;
    switch (meta.msgType) {
      case "NBIRTH":
      case "DBIRTH":
        handleBirth(meta, m);
        break;
      case "NDATA":
      case "DDATA":
        handleData(meta, m);
        break;
      case "NDEATH":
      case "DDEATH":
        handleDeath(meta, m);
        break;
      case "STATE":
        handleState(meta, m);
        break;
      default:
        // NCMD/DCMD (and unknown types): traffic exists but carries no tree
        // state we track.
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
    // Only recompute when there is something to recompute.
    if (groups.size > 0 || hosts.size > 0) flush();
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
    hasSparkplug = false;
    structureChanged = true;
    lastGroupByName.clear();
    dataEpoch++;
  };

  const onConnectionDown = () => {
    if (connected) droppedAtMs = Date.now();
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
      // no Sparkplug traffic. Live traffic is never held back for the
      // backfill: folding is order-independent and warning counters dedupe
      // by message id, so the replay can land before or after this batch.
      if (!ingest(messages)) return;
      flush();
      // Sparkplug traffic on this connection is the signal that the retained
      // history is worth fetching. Single-shot.
      if (!backfillStarted) void startBackfill();
    });
    offClear = Events.On(eventSet.mqttClearHistory, () => {
      resetData();
      flush();
    });
    offConnected = Events.On(eventSet.mqttConnected, () => {
      connected = true;
      startTicker();
      markAllDirty();
      flush();
    });
    // A drop and a deliberate disconnect are the same to the tree: nothing
    // can be known about what happens while away, so the tree keeps its last
    // values and marks everything as not heard from since.
    offDisconnected = Events.On(eventSet.mqttDisconnected, onConnectionDown);
    offReconnecting = Events.On(eventSet.mqttReconnecting, onConnectionDown);
  };

  // Replays the connection's Sparkplug history (already enriched by the
  // backend middleware): the latest birth, death and value-carrying message
  // per metric, so a view opened mid-session starts from the same tree it
  // would have reached watching live. Live traffic keeps flowing while it is
  // in flight; folding is order-independent. Guarded by dataEpoch against a
  // clear racing the fetch.
  const backfill = async () => {
    const epoch = dataEpoch;
    try {
      const history = (await GetSparkplugMessageHistory(connectionId)) ?? [];
      if (destroyed || epoch !== dataEpoch) return; // torn down / cleared
      if (ingest(history)) flush();
    } catch (e) {
      console.error("sparkplug-tree: history backfill failed", e);
    }
  };

  const clearIdleBackfillTimer = () => {
    if (idleBackfillTimer !== null) {
      clearTimeout(idleBackfillTimer);
      idleBackfillTimer = null;
    }
  };

  /** Runs the backfill at most once per store, whatever triggered it. */
  const startBackfill = (): Promise<void> => {
    if (backfillStarted) return backfillPromise ?? Promise.resolve();
    backfillStarted = true;
    clearIdleBackfillTimer();
    backfillPromise = backfill();
    return backfillPromise;
  };

  /**
   * Called when the user opens the Sparkplug view. Idempotent: it only forces
   * the one-shot history backfill if no live message has triggered it yet.
   */
  const activate = (): Promise<void> => startBackfill();

  // Opens the store: binds the live listeners only. The history fetch is
  // deferred (see startBackfill) so mounting a connection panel costs nothing
  // on the backend; the idle timer is the fallback for a dormant connection
  // whose Sparkplug traffic stopped before this mount.
  const init = () => {
    bindListeners();
    if (connected) startTicker();
    idleBackfillTimer = setTimeout(() => {
      idleBackfillTimer = null;
      void startBackfill();
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
    destroy,
    /** Test/inspection helper: current state snapshot. */
    snapshot: () => get({ subscribe }),
    connectionId,
  };
};
