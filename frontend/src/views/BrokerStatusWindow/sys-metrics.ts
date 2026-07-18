// Builtin $SYS metric registry for the Broker Status window, plus the pure
// helpers the store/view need: wildcard topic matching, candidate selection,
// payload parsing (via the chart's valueAtPath), override/custom mapping
// merging, duration humanizing, and SI value formatting.
//
// Broker families covered by builtin candidates (first candidate with data
// wins — no explicit broker detection):
//   - mosquitto-style ($SYS/broker/…) — also NanoMQ, Mochi.
//   - EMQX ($SYS/brokers/<node>/…). EMQX 5.x publishes stats/metrics topics
//     with dots translated to slashes (stats/connections/count); EMQX 4.x
//     kept dots in stats topics (stats/connections.count) but used slashes in
//     metrics topics. Both spellings are listed. Metrics are cumulative
//     counters (the store derives a rate). Uptime is bare milliseconds on
//     5.x and a human string ("28 days, 15 hours, …") on 4.x — the human
//     string simply falls through to raw-text display, which is already
//     humanized.
//   - VerneMQ ($SYS/<node>/…): vmq_systree publishes every metric name with
//     underscores split into topic levels and bare numeric payloads
//     (vmq_systree.erl: `Prefix ++ re:split(Metric, "_")`,
//     `integer_to_binary/float_to_binary`). Relevant metrics:
//     total_active_connections (gauge), mqtt_publish_received/sent (counter),
//     bytes_received/sent (counter), router_subscriptions (gauge),
//     retain_messages (gauge), system_wallclock (ms since node start).
//     There is no version metric, so the version tile has no VerneMQ
//     candidate.

import { valueAtPath } from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/payload-fields";

// How a candidate's payload is interpreted.
//   gauge      — numeric value shown as-is (after `scale`).
//   cumulative — monotonically increasing counter; the store derives a /s
//                rate from successive samples.
//   duration   — seconds ("123 seconds", or bare number × scale); the view
//                renders it via humanizeDuration.
//   string     — raw text passthrough (e.g. version).
export type MetricKind = "gauge" | "cumulative" | "duration" | "string";

export interface MetricCandidate {
  /** Exact topic or pattern with `+` single-level wildcards. */
  pattern: string;
  /** Dotted JSON path into the payload; "" = whole payload. */
  payloadPath: string;
  kind: MetricKind;
  /**
   * Multiplier applied to numeric values. E.g. mosquitto "load/…/1min" values
   * are per-MINUTE moving averages → 1/60 to display /s; VerneMQ/EMQX-5
   * uptime is milliseconds → 1/1000 to get seconds.
   */
  scale?: number;
}

export interface MetricTile {
  /** Builtin metric id, or "custom:…" for user-defined tiles. */
  key: string;
  label: string;
  /** Optional display suffix (mainly for custom tiles). */
  unit?: string;
  /** Ordered candidates; first with data wins. Empty for computed tiles. */
  candidates: MetricCandidate[];
  /** Client-side computed tiles (observed rates, derived ratios) — no topics. */
  computed?: boolean;
  tooltip?: string;
  /** Kind used when a user override redirects this builtin to their topic. */
  overrideKind?: MetricKind;
  /**
   * v2: the metric is tracked (value + samples fold into runtime and are
   * exposed via the store's `metricByKey`) but has no gauge tile of its own —
   * its samples feed the traffic hero, health chips, the facts row, or a
   * derived ratio instead. Independent of `overrideTarget`: `uptime`/`version`
   * are hidden yet remain override targets.
   *
   * NOTE (commit-staging): the hidden→no-tile filter is applied by the store's
   * visible-tile predicate, and in the store-engine commit that predicate still
   * keeps the reclassified v1 tiles (`msg_rate_*`, `uptime`, `version`) on
   * screen. The brand-new hidden metrics below never surface as tiles.
   */
  hidden?: boolean;
  /**
   * v2: excluded from the mapping editor's override Select. Defaults to true
   * (absent = an override target). Set false for the internal diagnostic /
   * derived-input metrics that would only confuse a manual remap.
   */
  overrideTarget?: boolean;
}

/**
 * Structural mirror of the SysMetricMapping binding row. Typed locally on
 * purpose — bindings may be regenerating while this module is worked on.
 */
export interface SysMetricMappingRow {
  /**
   * Persistent row id from the binding. Optional because a locally-built row
   * (tests, fixtures) may not have one; when present it gives custom tiles a
   * stable key so deleting one row doesn't rename the survivors.
   */
  id?: number;
  metricKey: string; // builtin tile id to override, or "" = custom tile
  label: string;
  topic: string;
  payloadPath: string;
  unit: string;
  sortOrder: number;
}

export type ParsedSample =
  | { kind: "number"; value: number }
  | { kind: "text"; text: string };

const MINUTE_AVG = 1 / 60; // mosquitto load/*/1min → per-second
const MS = 1 / 1000; // milliseconds → seconds

export const OBSERVED_TOOLTIP =
  "Measured by this client across its subscriptions";

export const BUILTIN_METRICS: readonly MetricTile[] = [
  {
    key: "clients_connected",
    label: "Connected clients",
    overrideKind: "gauge",
    candidates: [
      { pattern: "$SYS/broker/clients/connected", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/brokers/+/stats/connections/count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/brokers/+/stats/connections.count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/+/total/active/connections", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "msg_rate_in",
    label: "Msgs/s in",
    // v2: samples feed the traffic hero's inbound series, not a gauge tile.
    hidden: true,
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/messages/received/1min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
      { pattern: "$SYS/brokers/+/metrics/messages/received", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/brokers/+/metrics/messages.received", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/+/mqtt/publish/received", payloadPath: "", kind: "cumulative" },
    ],
  },
  {
    key: "msg_rate_out",
    label: "Msgs/s out",
    // v2: samples feed the traffic hero's outbound series, not a gauge tile.
    hidden: true,
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/messages/sent/1min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
      { pattern: "$SYS/brokers/+/metrics/messages/sent", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/brokers/+/metrics/messages.sent", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/+/mqtt/publish/sent", payloadPath: "", kind: "cumulative" },
    ],
  },
  {
    key: "bytes_rate_in",
    label: "Bytes/s in",
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/bytes/received/1min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
      { pattern: "$SYS/brokers/+/metrics/bytes/received", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/brokers/+/metrics/bytes.received", payloadPath: "", kind: "cumulative" },
      // Also matches mosquitto's cumulative $SYS/broker/bytes/received —
      // fine: it only wins when the load/1min average is absent, and it has
      // the same cumulative semantics.
      { pattern: "$SYS/+/bytes/received", payloadPath: "", kind: "cumulative" },
    ],
  },
  {
    key: "bytes_rate_out",
    label: "Bytes/s out",
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/bytes/sent/1min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
      { pattern: "$SYS/brokers/+/metrics/bytes/sent", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/brokers/+/metrics/bytes.sent", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/+/bytes/sent", payloadPath: "", kind: "cumulative" },
    ],
  },
  {
    key: "subscriptions",
    label: "Subscriptions",
    overrideKind: "gauge",
    candidates: [
      { pattern: "$SYS/broker/subscriptions/count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/brokers/+/stats/subscriptions/count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/brokers/+/stats/subscriptions.count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/+/router/subscriptions", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "retained",
    label: "Retained msgs",
    overrideKind: "gauge",
    candidates: [
      // mosquitto's topic genuinely contains a space — keep verbatim.
      { pattern: "$SYS/broker/retained messages/count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/brokers/+/stats/retained/count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/brokers/+/stats/retained.count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/+/retain/messages", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "uptime",
    label: "Uptime",
    // v2: feeds the facts row, not a gauge tile — but stays an override target.
    hidden: true,
    overrideKind: "duration",
    candidates: [
      // mosquitto: "3672 seconds"
      { pattern: "$SYS/broker/uptime", payloadPath: "", kind: "duration" },
      // EMQX 5.x: bare milliseconds; EMQX 4.x: human string (falls through
      // to raw-text display, which is already humanized).
      { pattern: "$SYS/brokers/+/uptime", payloadPath: "", kind: "duration", scale: MS },
      // VerneMQ: system_wallclock, milliseconds since node start.
      { pattern: "$SYS/+/system/wallclock", payloadPath: "", kind: "duration", scale: MS },
    ],
  },
  {
    key: "version",
    label: "Broker",
    // v2: feeds the facts row, not a gauge tile — but stays an override target.
    hidden: true,
    overrideKind: "string",
    candidates: [
      { pattern: "$SYS/broker/version", payloadPath: "", kind: "string" },
      { pattern: "$SYS/brokers/+/version", payloadPath: "", kind: "string" },
      { pattern: "$SYS/brokers/+/sysdescr", payloadPath: "", kind: "string" },
      // VerneMQ systree publishes no version metric.
    ],
  },

  // --- v2 hidden diagnostic / facts / legend metrics -------------------------
  // All `hidden` (no gauge tile of their own) and NOT override targets (they
  // are broker-family-specific signals; a manual remap would only confuse).
  // Their samples are tracked in runtime and reach the view via `metricByKey`.
  {
    key: "msgs_dropped",
    label: "Dropped msgs/s",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      // mosquitto: per-minute average count of dropped publishes → per-second.
      {
        pattern: "$SYS/broker/load/publish/dropped/1min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
      // Cumulative dropped counters across broker families; the store derives a
      // /s rate from successive samples (same as the msg-rate tiles).
      { pattern: "$SYS/broker/mqtt/publish/dropped", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/broker/publish/messages/dropped", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/broker/messages/publish/dropped", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/broker/messages/dropped", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/brokers/+/metrics/messages/dropped", payloadPath: "", kind: "cumulative" },
    ],
  },
  {
    key: "delivery_backlog",
    label: "Delivery backlog",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      // mosquitto-8: "current number of packets queued" — a gauge, not a
      // counter (an idle-broker fixture asserts it plateaus before the chip
      // binds; see the registry tests).
      { pattern: "$SYS/broker/packet/out/count", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "heap_current",
    label: "Heap in use",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      { pattern: "$SYS/broker/heap/current", payloadPath: "", kind: "gauge" },
      // aedes-stats + similar `+`-node brokers. NOT Mochi's system/memory
      // (process memory, deliberately unbound per the spec).
      { pattern: "$SYS/+/memory/heap/current", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "heap_max",
    label: "Heap peak",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      // A high-watermark, not a capacity ceiling.
      { pattern: "$SYS/broker/heap/maximum", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/+/memory/heap/maximum", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "store_msgs",
    label: "Stored messages",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      { pattern: "$SYS/broker/store/messages/count", payloadPath: "", kind: "gauge" },
      { pattern: "$SYS/broker/messages/stored", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "store_bytes",
    label: "Stored bytes",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      { pattern: "$SYS/broker/store/messages/bytes", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "clients_disconnected",
    label: "Disconnected clients",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      { pattern: "$SYS/broker/clients/disconnected", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "clients_expired",
    label: "Expired clients",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      { pattern: "$SYS/broker/clients/expired", payloadPath: "", kind: "gauge" },
    ],
  },
  {
    key: "sockets_1min",
    label: "Socket churn/s",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/sockets/1min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
      {
        pattern: "$SYS/broker/load/connections/1min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
    ],
  },
  // Broker-published 5m/15m load averages — legend-tooltip context only.
  {
    key: "msg_rate_in_5min",
    label: "Msgs/s in (5m avg)",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/messages/received/5min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
    ],
  },
  {
    key: "msg_rate_in_15min",
    label: "Msgs/s in (15m avg)",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/messages/received/15min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
    ],
  },
  {
    key: "msg_rate_out_5min",
    label: "Msgs/s out (5m avg)",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/messages/sent/5min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
    ],
  },
  {
    key: "msg_rate_out_15min",
    label: "Msgs/s out (15m avg)",
    hidden: true,
    overrideTarget: false,
    overrideKind: "gauge",
    candidates: [
      {
        pattern: "$SYS/broker/load/messages/sent/15min",
        payloadPath: "",
        kind: "gauge",
        scale: MINUTE_AVG,
      },
    ],
  },
  // Cumulative message totals: feed the fan-out ratio and avg-msg-size derived
  // tiles (the store diffs successive samples into a /s rate).
  {
    key: "messages_received_total",
    label: "Messages received",
    hidden: true,
    overrideTarget: false,
    overrideKind: "cumulative",
    candidates: [
      { pattern: "$SYS/broker/messages/received", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/brokers/+/metrics/messages/received", payloadPath: "", kind: "cumulative" },
    ],
  },
  {
    key: "messages_sent_total",
    label: "Messages sent",
    hidden: true,
    overrideTarget: false,
    overrideKind: "cumulative",
    candidates: [
      { pattern: "$SYS/broker/messages/sent", payloadPath: "", kind: "cumulative" },
      { pattern: "$SYS/brokers/+/metrics/messages/sent", payloadPath: "", kind: "cumulative" },
    ],
  },

  // Derived ratios computed on the tick from the hidden cumulative pair above.
  // Hidden here (they reach the gauges grid via `metricByKey`); the store fills
  // or clears them per the derived-rate guards.
  {
    key: "fan_out",
    label: "Fan-out",
    hidden: true,
    overrideTarget: false,
    computed: true,
    candidates: [],
  },
  {
    key: "avg_msg_size",
    label: "Avg msg size",
    hidden: true,
    overrideTarget: false,
    computed: true,
    candidates: [],
  },

  // Client-side computed tiles — always present, no topics; the store fills
  // their values from its observed-rate ring buffer.
  {
    key: "observed_msg_rate",
    label: "Observed msgs/s",
    candidates: [],
    computed: true,
    tooltip: OBSERVED_TOOLTIP,
  },
  {
    key: "observed_byte_rate",
    label: "Observed bytes/s",
    candidates: [],
    computed: true,
    tooltip: OBSERVED_TOOLTIP,
  },
];

/**
 * MQTT-style topic matching with `+` single-level wildcards. `$SYS` gets no
 * special-casing here: patterns in this module address `$SYS` explicitly and
 * `+` may match any level, including one containing spaces or `@` (VerneMQ
 * node names like "VerneMQ@127.0.0.1" are a single level).
 */
export function topicMatchesPattern(pattern: string, topic: string): boolean {
  const patternLevels = pattern.split("/");
  const topicLevels = topic.split("/");
  for (let i = 0; i < patternLevels.length; i++) {
    const level = patternLevels[i];
    if (level === "#") {
      // Multi-level wildcard: matches zero or more remaining levels. Only valid
      // as the final level (mosquitto semantics; mirrors the topic tree's
      // filter matcher). "a/#" therefore matches "a", "a/b", "a/b/c".
      return i === patternLevels.length - 1;
    }
    if (i >= topicLevels.length) return false;
    if (level !== "+" && level !== topicLevels[i]) return false;
  }
  return patternLevels.length === topicLevels.length;
}

export interface SelectedCandidate {
  candidate: MetricCandidate;
  topic: string;
}

/**
 * Picks the tile's winning candidate: the first candidate (in registry
 * order) that matches at least one of `topics` — the set of topics the
 * store has data for. When a wildcard matches several topics (e.g. a
 * multi-node EMQX cluster) the lexicographically smallest topic is used so
 * the choice is deterministic.
 */
export function selectCandidate(
  tile: Pick<MetricTile, "candidates">,
  topics: Iterable<string>
): SelectedCandidate | null {
  const all = Array.from(topics);
  for (const candidate of tile.candidates) {
    const matches = all.filter((t) =>
      topicMatchesPattern(candidate.pattern, t)
    );
    if (matches.length > 0) {
      matches.sort();
      return { candidate, topic: matches[0] };
    }
  }
  return null;
}

// A payload that is a whole-string duration like "3672 seconds" (mosquitto
// uptime). Anchored so EMQX 4.x human strings ("3 days, 4 hours, …") do not
// half-match.
const SECONDS_PAYLOAD = /^\s*(\d+(?:\.\d+)?)\s*seconds?\s*$/i;

/**
 * Parses a candidate's payload into a sample. Numeric extraction goes
 * through the chart's `valueAtPath` (empty path = whole payload; handles
 * bare and quoted numerics, scientific notation — VerneMQ floats arrive as
 * "2.30000000000000000000e+01"). Anything non-parseable is returned as raw
 * text — never NaN.
 */
export function parseSample(
  candidate: MetricCandidate,
  payload: string
): ParsedSample {
  if (candidate.kind === "string") {
    return { kind: "text", text: payload.trim() };
  }
  if (candidate.kind === "duration") {
    const m = SECONDS_PAYLOAD.exec(payload);
    if (m) return { kind: "number", value: Number(m[1]) };
  }
  const value = valueAtPath(payload, candidate.payloadPath);
  if (value === null) return { kind: "text", text: payload.trim() };
  return { kind: "number", value: value * (candidate.scale ?? 1) };
}

/**
 * Merges the builtin registry with per-connection SysMetricMapping rows into
 * the effective tile list:
 *   - Override rows (metricKey = a builtin id) replace that builtin's
 *     candidates with the user's exact topic/path (kind = the builtin's
 *     overrideKind); non-empty label/unit replace the builtin's. If several
 *     rows override the same builtin, the highest sortOrder wins.
 *   - Custom rows (metricKey "") append as custom tiles after the builtins,
 *     ordered by sortOrder (ties keep input order).
 *   - Rows referencing an unknown metricKey are kept as custom tiles rather
 *     than silently dropped.
 */
export function mergeMappings(
  mappings: readonly SysMetricMappingRow[],
  builtins: readonly MetricTile[] = BUILTIN_METRICS
): MetricTile[] {
  const overrides = new Map<string, SysMetricMappingRow>();
  const customs: SysMetricMappingRow[] = [];
  const builtinKeys = new Set(builtins.map((b) => b.key));

  for (const row of mappings) {
    if (row.metricKey !== "" && builtinKeys.has(row.metricKey)) {
      const existing = overrides.get(row.metricKey);
      if (existing === undefined || row.sortOrder >= existing.sortOrder) {
        overrides.set(row.metricKey, row);
      }
    } else {
      customs.push(row);
    }
  }

  const tiles: MetricTile[] = builtins.map((builtin) => {
    const row = overrides.get(builtin.key);
    if (row === undefined) return builtin;
    return {
      ...builtin,
      label: row.label !== "" ? row.label : builtin.label,
      unit: row.unit !== "" ? row.unit : builtin.unit,
      candidates: [
        {
          pattern: row.topic,
          payloadPath: row.payloadPath,
          kind: builtin.overrideKind ?? "gauge",
        },
      ],
    };
  });

  customs
    .map((row, i) => ({ row, i }))
    .sort((a, b) => a.row.sortOrder - b.row.sortOrder || a.i - b.i)
    .forEach(({ row }) => {
      tiles.push({
        // Key on the row's persistent id when present so deleting one custom
        // row doesn't renumber (and therefore reset the runtime of) the others.
        // Fall back to topic#path for locally-built rows without an id.
        key: `custom:${row.id ?? `${row.topic}#${row.payloadPath}`}`,
        label: row.label !== "" ? row.label : row.topic,
        unit: row.unit !== "" ? row.unit : undefined,
        candidates: [
          { pattern: row.topic, payloadPath: row.payloadPath, kind: "gauge" },
        ],
      });
    });

  return tiles;
}

/**
 * Humanizes a duration in seconds into its two most significant units:
 * "45s", "2m 3s", "2h 3m", "3d 4h" (the second unit is dropped when zero).
 */
export function humanizeDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const units: Array<[number, string]> = [
    [d, "d"],
    [h, "h"],
    [m, "m"],
    [s, "s"],
  ];
  const first = units.findIndex(([v]) => v > 0);
  if (first === -1) return "0s";
  const parts = [`${units[first][0]}${units[first][1]}`];
  if (first + 1 < units.length && units[first + 1][0] > 0) {
    parts.push(`${units[first + 1][0]}${units[first + 1][1]}`);
  }
  return parts.join(" ");
}

const SI_TIERS: Array<[number, string]> = [
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
];

const trimDecimal = (n: number): string => {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

/**
 * Formats a tile value with SI abbreviations for large numbers and at most
 * one decimal place: 950 → "950", 1234 → "1.2k", 3_400_000 → "3.4M",
 * 42.567 → "42.6". Values that round up to the next tier move up
 * (999_950 → "1M", not "1000k").
 */
export function formatMetricValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  for (const [tier, suffix] of SI_TIERS) {
    if (abs >= tier) {
      const scaled = Math.round((abs / tier) * 10) / 10;
      if (scaled >= 1000) {
        // Rounded into the next tier (e.g. 999_950 / 1k → 1000k → 1M).
        const upIdx = SI_TIERS.findIndex(([t]) => t === tier) - 1;
        if (upIdx >= 0) {
          return `${sign}${trimDecimal(abs / SI_TIERS[upIdx][0])}${SI_TIERS[upIdx][1]}`;
        }
      }
      return `${sign}${trimDecimal(scaled)}${suffix}`;
    }
  }
  return `${sign}${trimDecimal(abs)}`;
}
