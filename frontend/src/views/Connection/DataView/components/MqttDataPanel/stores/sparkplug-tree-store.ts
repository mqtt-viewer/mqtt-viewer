// Data store for the Sparkplug session tree (the "Sparkplug" mode of the data
// panel). It folds the backend's already-enriched Sparkplug messages (the
// middlewareProperties["sparkplug"] meta plus name-injected protojson
// payloads) into a live group -> edge node -> device -> metric inventory with
// health diagnostics: seq-gap flags, rebirth-storm warnings and host STATE
// tracking. See docs/specs/research/stateful-sparkplug-decode.md.
//
// Performance contract (mirrors broker-status-store):
//   - The all-messages feed does a cheap early exit per message: anything
//     without sparkplug middleware meta costs one property read, no allocs.
//   - Svelte store writes are coalesced: at most one `set` per incoming batch
//     event and one per 1 s ticker tick — never per message.
//   - State is bounded: metric/node maps are bounded by distinct names in the
//     traffic, warnings are capped at WARNING_CAP, the per-node birth ring at
//     BIRTH_RING_CAP.

import { get, writable } from "svelte/store";
import { Events } from "@wailsio/runtime";
import type * as events from "bindings/mqtt-viewer/events/models";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import { GetSparkplugMessageHistory } from "bindings/mqtt-viewer/backend/app/app";

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

/**
 * Fixed staleness threshold: a metric with no update for this long (while its
 * node is online) is flagged stale. Fixed rather than adaptive per-cadence —
 * the spec's open question #1 resolves to a fixed default; the row tooltip
 * shows the threshold.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;
/** Warnings strip cap; oldest entries are dropped, newest kept last. */
export const WARNING_CAP = 50;
/** Per-node birth-timestamp ring size for rebirth-storm detection. */
export const BIRTH_RING_CAP = 16;
/** A storm is >= this many births within REBIRTH_STORM_WINDOW_MS. */
export const REBIRTH_STORM_COUNT = 4;
export const REBIRTH_STORM_WINDOW_MS = 90_000;
/** Consecutive identical seq-gap warnings within this window are deduped. */
export const SEQ_GAP_DEDUPE_MS = 5_000;
/** Ticker cadence for recomputing stale flags / relative last-seen labels. */
export const TICKER_MS = 1000;

/** Sparkplug B datatype codes -> human names (others render "Type <n>"). */
const DATATYPE_NAMES: Record<number, string> = {
  1: "Int8",
  2: "Int16",
  3: "Int32",
  4: "Int64",
  5: "UInt8",
  6: "UInt16",
  7: "UInt32",
  8: "UInt64",
  9: "Float",
  10: "Double",
  11: "Boolean",
  12: "String",
  13: "DateTime",
  14: "Text",
  15: "UUID",
};

export const datatypeName = (code: number | undefined): string => {
  if (code === undefined || code === null) return "";
  return DATATYPE_NAMES[code] ?? `Type ${code}`;
};

// --- Public state shape (buildState snapshot) ---------------------------------

export interface SparkplugHost {
  hostId: string;
  online: boolean;
  sinceMs: number;
}

export interface SparkplugMetric {
  name: string;
  /** True when the name is an `alias_<n>` stand-in (no birth seen). */
  placeholder: boolean;
  typeName: string;
  /** Display-formatted value (numbers trimmed to <= 6 significant digits). */
  value: string;
  /** Untrimmed value for copy. */
  valueRaw: string;
  /** Arrival time of the message that last updated this metric. */
  lastSeenMs: number;
  /** Device-reported timestamp (metric or payload level); clocks lie. */
  payloadTsMs?: number;
  stale: boolean;
  isNull?: boolean;
  isHistorical?: boolean;
  isTransient?: boolean;
}

export interface SparkplugDevice {
  name: string;
  online: boolean;
  metrics: SparkplugMetric[];
  lastSeenMs: number;
  deathAtMs?: number;
}

export interface SparkplugNode {
  group: string;
  name: string;
  online: boolean;
  bdSeq?: number;
  seqOk: boolean;
  lastSeqGap?: { expected: number; got: number };
  metricCount: number;
  birthAtMs?: number;
  lastSeenMs: number;
  /** Births seen in the trailing 90 s window (rebirth-storm indicator). */
  rebirthCount90s: number;
  metrics: SparkplugMetric[];
  devices: SparkplugDevice[];
  hasBirth: boolean;
  deathAtMs?: number;
}

export interface SparkplugGroup {
  name: string;
  nodes: SparkplugNode[];
}

export type SparkplugWarningKind = "seq-gap" | "rebirth-storm";

export interface SparkplugWarning {
  /** Edge node display name, e.g. "substation-4". */
  node: string;
  text: string;
  timeMs: number;
  kind: SparkplugWarningKind;
}

export interface SparkplugTreeState {
  hasSparkplug: boolean;
  hosts: SparkplugHost[];
  groups: SparkplugGroup[];
  /** Capped at WARNING_CAP, newest last. */
  warnings: SparkplugWarning[];
  warningCount: number;
  /**
   * Reference "now" for relative last-seen / stale rendering. Frozen at the
   * disconnect time while the connection is down so staleness stops counting.
   */
  nowMs: number;
}

export type SparkplugTreeStore = ReturnType<typeof createSparkplugTreeStore>;

// --- Internal runtime (mutated in place; snapshotted by buildState) -----------

interface MetricRt {
  name: string;
  placeholder: boolean;
  typeName: string;
  value: string;
  valueRaw: string;
  lastSeenMs: number;
  payloadTsMs?: number;
  isNull?: boolean;
  isHistorical?: boolean;
  isTransient?: boolean;
}

interface DeviceRt {
  name: string;
  online: boolean;
  hasBirth: boolean;
  lastSeenMs: number;
  deathAtMs?: number;
  metrics: Map<string, MetricRt>;
}

interface NodeRt {
  group: string;
  name: string;
  online: boolean;
  hasBirth: boolean;
  bdSeq?: number;
  seqOk: boolean;
  lastSeqGap?: { expected: number; got: number };
  birthAtMs?: number;
  lastSeenMs: number;
  deathAtMs?: number;
  /** Ring of NBIRTH arrival times (capped) for rebirth-storm detection. */
  birthRing: number[];
  /** The storm warning currently attached to this node, if a storm is live. */
  stormWarning: SparkplugWarning | null;
  lastSeqGapWarning: { expected: number; got: number; timeMs: number } | null;
  metrics: Map<string, MetricRt>;
  devices: Map<string, DeviceRt>;
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
  seqGap?: { expected: number; got: number };
  bdSeq?: number;
}

// Protojson metric shape (names already injected by the backend middleware).
interface PayloadMetric {
  name?: string;
  alias?: string | number;
  timestamp?: string | number;
  datatype?: number;
  isHistorical?: boolean;
  isTransient?: boolean;
  isNull?: boolean;
  intValue?: number;
  longValue?: string;
  floatValue?: number;
  doubleValue?: number;
  booleanValue?: boolean;
  stringValue?: string;
  bytesValue?: string;
}

/** Trims a number to <= 6 significant digits for display. */
const formatNumber = (n: number): string => {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(6)));
};

/**
 * Reads the protojson value oneof off a metric. Returns the display string
 * (numbers trimmed) and the raw string (for copy). isNull wins over the oneof.
 */
const extractMetricValue = (
  m: PayloadMetric
): { value: string; valueRaw: string } => {
  if (m.isNull) return { value: "null", valueRaw: "null" };
  if (m.intValue !== undefined) {
    return { value: formatNumber(m.intValue), valueRaw: String(m.intValue) };
  }
  if (m.longValue !== undefined) {
    // protojson renders 64-bit ints as strings; show numerically when safe.
    // Number() loses precision beyond 2^53, so an integer that isn't a safe
    // integer falls back to the original string rather than a rounded value.
    const n = Number(m.longValue);
    const lossy = !Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n));
    return {
      value: lossy ? m.longValue : formatNumber(n),
      valueRaw: m.longValue,
    };
  }
  if (m.floatValue !== undefined) {
    return {
      value: formatNumber(m.floatValue),
      valueRaw: String(m.floatValue),
    };
  }
  if (m.doubleValue !== undefined) {
    return {
      value: formatNumber(m.doubleValue),
      valueRaw: String(m.doubleValue),
    };
  }
  if (m.booleanValue !== undefined) {
    return { value: String(m.booleanValue), valueRaw: String(m.booleanValue) };
  }
  if (m.stringValue !== undefined) {
    return { value: m.stringValue, valueRaw: m.stringValue };
  }
  if (m.bytesValue !== undefined) {
    return { value: m.bytesValue, valueRaw: m.bytesValue };
  }
  return { value: "", valueRaw: "" };
};

const metricDisplayName = (m: PayloadMetric): string => {
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
  const hosts = new Map<string, { online: boolean; sinceMs: number }>();
  let warnings: SparkplugWarning[] = [];
  let hasSparkplug = false;

  let connected = opts.connected ?? true;
  // While disconnected, staleness/relative-time computation freezes at this
  // instant (a down link must not mark every metric stale).
  let disconnectedAtMs: number | null = null;

  // Bumped on clear-history so an in-flight backfill can't resurrect state.
  let dataEpoch = 0;

  // Set by destroy(); guards against init()'s backfill continuation running
  // (and leaking a ticker) after the store has been torn down.
  let destroyed = false;

  // True while GetSparkplugMessageHistory is in flight. Live batches that
  // arrive during that window are queued (not ingested) so a message present
  // in both the backfill result and a live batch isn't double-processed.
  let backfillInFlight = false;
  let pendingLiveBatches: mqtt.MqttMessage[][] = [];

  const refNowMs = () => disconnectedAtMs ?? Date.now();

  const ensureNode = (group: string, name: string): NodeRt => {
    let nodes = groups.get(group);
    if (!nodes) {
      nodes = new Map();
      groups.set(group, nodes);
    }
    let node = nodes.get(name);
    if (!node) {
      node = {
        group,
        name,
        online: false,
        hasBirth: false,
        seqOk: true,
        lastSeenMs: 0,
        birthRing: [],
        stormWarning: null,
        lastSeqGapWarning: null,
        metrics: new Map(),
        devices: new Map(),
      };
      nodes.set(name, node);
    }
    return node;
  };

  const ensureDevice = (node: NodeRt, name: string): DeviceRt => {
    let device = node.devices.get(name);
    if (!device) {
      device = {
        name,
        online: false,
        hasBirth: false,
        lastSeenMs: 0,
        metrics: new Map(),
      };
      node.devices.set(name, device);
    }
    return device;
  };

  const pushWarning = (w: SparkplugWarning) => {
    warnings.push(w);
    if (warnings.length > WARNING_CAP) warnings.shift();
  };

  // --- Snapshot ---------------------------------------------------------------

  const buildMetric = (rt: MetricRt, nodeOnline: boolean, nowMs: number): SparkplugMetric => ({
    name: rt.name,
    placeholder: rt.placeholder,
    typeName: rt.typeName,
    value: rt.value,
    valueRaw: rt.valueRaw,
    lastSeenMs: rt.lastSeenMs,
    payloadTsMs: rt.payloadTsMs,
    // Stale only counts against an online node; an offline node is already
    // flagged by its death state.
    stale: nodeOnline && nowMs - rt.lastSeenMs > STALE_AFTER_MS,
    isNull: rt.isNull,
    isHistorical: rt.isHistorical,
    isTransient: rt.isTransient,
  });

  const buildState = (): SparkplugTreeState => {
    const nowMs = refNowMs();
    const outGroups: SparkplugGroup[] = [];
    for (const groupName of Array.from(groups.keys()).sort()) {
      const nodes = groups.get(groupName)!;
      const outNodes: SparkplugNode[] = [];
      for (const nodeName of Array.from(nodes.keys()).sort()) {
        const n = nodes.get(nodeName)!;
        const metrics: SparkplugMetric[] = [];
        for (const m of n.metrics.values()) {
          metrics.push(buildMetric(m, n.online, nowMs));
        }
        const devices: SparkplugDevice[] = [];
        for (const dName of Array.from(n.devices.keys()).sort()) {
          const d = n.devices.get(dName)!;
          const dMetrics: SparkplugMetric[] = [];
          for (const m of d.metrics.values()) {
            dMetrics.push(buildMetric(m, n.online && d.online, nowMs));
          }
          devices.push({
            name: d.name,
            online: d.online,
            metrics: dMetrics,
            lastSeenMs: d.lastSeenMs,
            deathAtMs: d.deathAtMs,
          });
        }
        let rebirthCount90s = 0;
        for (const t of n.birthRing) {
          if (nowMs - t <= REBIRTH_STORM_WINDOW_MS) rebirthCount90s++;
        }
        outNodes.push({
          group: n.group,
          name: n.name,
          online: n.online,
          bdSeq: n.bdSeq,
          seqOk: n.seqOk,
          lastSeqGap: n.lastSeqGap,
          metricCount: n.metrics.size,
          birthAtMs: n.birthAtMs,
          lastSeenMs: n.lastSeenMs,
          rebirthCount90s,
          metrics,
          devices,
          hasBirth: n.hasBirth,
          deathAtMs: n.deathAtMs,
        });
      }
      outGroups.push({ name: groupName, nodes: outNodes });
    }
    const outHosts: SparkplugHost[] = [];
    for (const hostId of Array.from(hosts.keys()).sort()) {
      const h = hosts.get(hostId)!;
      outHosts.push({ hostId, online: h.online, sinceMs: h.sinceMs });
    }
    return {
      hasSparkplug,
      hosts: outHosts,
      groups: outGroups,
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

  const upsertMetric = (
    metrics: Map<string, MetricRt>,
    pm: PayloadMetric,
    arrivalMs: number,
    payloadTs: string | number | undefined
  ) => {
    const name = metricDisplayName(pm);
    const { value, valueRaw } = extractMetricValue(pm);
    const existing = metrics.get(name);
    if (existing) {
      // Update in place — no new object per message.
      if (pm.datatype !== undefined) existing.typeName = datatypeName(pm.datatype);
      existing.value = value;
      existing.valueRaw = valueRaw;
      existing.lastSeenMs = arrivalMs;
      existing.payloadTsMs = parseTsMs(pm.timestamp, payloadTs);
      existing.isNull = pm.isNull;
      existing.isHistorical = pm.isHistorical;
      existing.isTransient = pm.isTransient;
      return;
    }
    metrics.set(name, {
      name,
      placeholder: pm.name === undefined || pm.name === "",
      typeName: datatypeName(pm.datatype),
      value,
      valueRaw,
      lastSeenMs: arrivalMs,
      payloadTsMs: parseTsMs(pm.timestamp, payloadTs),
      isNull: pm.isNull,
      isHistorical: pm.isHistorical,
      isTransient: pm.isTransient,
    });
  };

  const handleBirth = (meta: SparkplugMeta, m: mqtt.MqttMessage) => {
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    const payload = parsePayload(m);
    const payloadMetrics: PayloadMetric[] = payload?.metrics ?? [];
    const isDevice = meta.device !== undefined;
    const scope = isDevice ? ensureDevice(node, meta.device!) : node;

    // Replace, never merge — stale mappings resolve silently to wrong names.
    scope.metrics = new Map();
    for (const pm of payloadMetrics) {
      // bdSeq is session plumbing; it is surfaced on the node row instead of
      // polluting the metric list.
      if (pm.name === "bdSeq") continue;
      upsertMetric(scope.metrics, pm, m.timeMs, payload?.timestamp);
    }
    scope.online = true;
    scope.hasBirth = true;
    scope.deathAtMs = undefined;
    scope.lastSeenMs = m.timeMs;
    node.lastSeenMs = m.timeMs;

    if (!isDevice) {
      node.birthAtMs = m.timeMs;
      if (meta.bdSeq !== undefined) node.bdSeq = meta.bdSeq;
      // A birth restarts the seq cycle: clear any earlier gap flag.
      node.seqOk = true;
      node.lastSeqGap = undefined;

      // Rebirth-storm detection: only NBIRTHs count (a node birthing its
      // devices at connect is normal; repeated NBIRTHs are the classic
      // duplicate-client-id symptom).
      node.birthRing.push(m.timeMs);
      if (node.birthRing.length > BIRTH_RING_CAP) node.birthRing.shift();
      let recent = 0;
      for (const t of node.birthRing) {
        if (m.timeMs - t <= REBIRTH_STORM_WINDOW_MS) recent++;
      }
      if (recent >= REBIRTH_STORM_COUNT) {
        const text = `${recent} rebirths in 90s, possible duplicate client id`;
        const live = node.stormWarning;
        if (live && warnings.includes(live)) {
          // Ongoing storm: refresh its count/time in place (one warning per
          // node per storm).
          live.text = text;
          live.timeMs = m.timeMs;
        } else {
          const w: SparkplugWarning = {
            node: node.name,
            text,
            timeMs: m.timeMs,
            kind: "rebirth-storm",
          };
          node.stormWarning = w;
          pushWarning(w);
        }
      } else {
        // Storm over — the next one gets a fresh warning.
        node.stormWarning = null;
      }
    }
  };

  const handleData = (meta: SparkplugMeta, m: mqtt.MqttMessage) => {
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    const isDevice = meta.device !== undefined;
    const scope = isDevice ? ensureDevice(node, meta.device!) : node;
    const payload = parsePayload(m);
    const payloadMetrics: PayloadMetric[] = payload?.metrics ?? [];
    for (const pm of payloadMetrics) {
      upsertMetric(scope.metrics, pm, m.timeMs, payload?.timestamp);
    }
    scope.lastSeenMs = m.timeMs;
    node.lastSeenMs = m.timeMs;

    const gap = meta.seqGap;
    if (gap) {
      node.seqOk = false;
      node.lastSeqGap = { expected: gap.expected, got: gap.got };
      const prev = node.lastSeqGapWarning;
      const isDuplicate =
        prev !== null &&
        prev.expected === gap.expected &&
        prev.got === gap.got &&
        m.timeMs - prev.timeMs <= SEQ_GAP_DEDUPE_MS;
      if (!isDuplicate) {
        pushWarning({
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
    const node = ensureNode(meta.group ?? "", meta.edgeNode ?? "");
    if (meta.device !== undefined) {
      const device = ensureDevice(node, meta.device);
      device.online = false;
      device.deathAtMs = m.timeMs;
      return;
    }
    node.online = false;
    node.deathAtMs = m.timeMs;
    if (meta.bdSeq !== undefined) node.bdSeq = meta.bdSeq;
    // NDEATH implies the node's devices are down too (their session died).
    for (const device of node.devices.values()) {
      device.online = false;
      device.deathAtMs = m.timeMs;
    }
  };

  const handleState = (meta: SparkplugMeta, m: mqtt.MqttMessage) => {
    const hostId = meta.hostId ?? "";
    if (hostId === "") return;
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
        });
        return;
      }
    } catch {
      // fall through to the legacy form
    }
    // Legacy 2.2 form: plain ONLINE / OFFLINE.
    const trimmed = text.trim().toUpperCase();
    if (trimmed === "ONLINE" || trimmed === "OFFLINE") {
      hosts.set(hostId, { online: trimmed === "ONLINE", sinceMs: m.timeMs });
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
        // state we track in v1.
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

  // --- Ticker (stale flags + relative last-seen rebuckets) --------------------

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
    hasSparkplug = false;
    dataEpoch++;
  };

  let offMessages: (() => void) | null = null;
  let offClear: (() => void) | null = null;
  let offConnected: (() => void) | null = null;
  let offDisconnected: (() => void) | null = null;

  const bindListeners = () => {
    offMessages = Events.On(eventSet.mqttMessages, (e: any) => {
      const messages: mqtt.MqttMessage[] = e.data ?? [];
      if (backfillInFlight) {
        // Backend history already contains anything committed before the
        // fetch started; queue live batches until we know which ids the
        // history already covered, so they aren't double-processed.
        pendingLiveBatches.push(messages);
        return;
      }
      // One coalesced store write per batch, and none at all for batches with
      // no Sparkplug traffic.
      if (ingest(messages)) flush();
    });
    offClear = Events.On(eventSet.mqttClearHistory, () => {
      resetData();
      flush();
    });
    offConnected = Events.On(eventSet.mqttConnected, () => {
      connected = true;
      disconnectedAtMs = null;
      startTicker();
      flush();
    });
    offDisconnected = Events.On(eventSet.mqttDisconnected, () => {
      connected = false;
      // Freeze staleness while down: metrics must not go stale against a
      // link that isn't delivering anything.
      disconnectedAtMs = Date.now();
      stopTicker();
      flush();
    });
  };

  // Replays the connection's retained Sparkplug history (already enriched by
  // the backend middleware) so births seen earlier in the session resolve
  // immediately. Guarded by dataEpoch against a clear racing the fetch.
  const backfill = async () => {
    const epoch = dataEpoch;
    backfillInFlight = true;
    try {
      const history = (await GetSparkplugMessageHistory(connectionId)) ?? [];
      if (epoch !== dataEpoch) return; // cleared mid-fetch → discard
      const historyIds = new Set(history.map((m) => m.id));
      ingest(history);
      for (const batch of pendingLiveBatches) {
        ingest(batch.filter((m) => !historyIds.has(m.id)));
      }
    } catch (e) {
      console.error("sparkplug-tree: history backfill failed", e);
    } finally {
      backfillInFlight = false;
      pendingLiveBatches = [];
    }
  };

  // Opens the store: binds live listeners first (so nothing is missed during
  // the async backfill), then replays history.
  const init = async () => {
    bindListeners();
    await backfill();
    if (destroyed) return;
    if (connected) startTicker();
    flush();
  };

  const destroy = () => {
    destroyed = true;
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
    destroy,
    /** Test/inspection helper: current state snapshot. */
    snapshot: () => get({ subscribe }),
    connectionId,
  };
};
