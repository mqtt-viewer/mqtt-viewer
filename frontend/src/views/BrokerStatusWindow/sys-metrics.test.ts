import { describe, it, expect } from "vitest";
import {
  BUILTIN_METRICS,
  formatMetricValue,
  humanizeDuration,
  mergeMappings,
  parseSample,
  selectCandidate,
  topicMatchesPattern,
  type MetricTile,
  type SysMetricMappingRow,
} from "./sys-metrics";

const builtin = (key: string): MetricTile => {
  const tile = BUILTIN_METRICS.find((m) => m.key === key);
  if (!tile) throw new Error(`no builtin metric ${key}`);
  return tile;
};

const mappingRow = (
  overrides: Partial<SysMetricMappingRow>
): SysMetricMappingRow => ({
  metricKey: "",
  label: "",
  topic: "",
  payloadPath: "",
  unit: "",
  sortOrder: 0,
  ...overrides,
});

// Retained/live $SYS topics as each broker family actually publishes them.
const MOSQUITTO_TOPICS = [
  "$SYS/broker/clients/connected",
  "$SYS/broker/load/messages/received/1min",
  "$SYS/broker/load/messages/sent/1min",
  "$SYS/broker/load/bytes/received/1min",
  "$SYS/broker/load/bytes/sent/1min",
  "$SYS/broker/subscriptions/count",
  "$SYS/broker/retained messages/count",
  "$SYS/broker/uptime",
  "$SYS/broker/version",
  "$SYS/broker/bytes/received", // cumulative sibling also exists
];

const EMQX5_TOPICS = [
  "$SYS/brokers/emqx@127.0.0.1/stats/connections/count",
  "$SYS/brokers/emqx@127.0.0.1/metrics/messages/received",
  "$SYS/brokers/emqx@127.0.0.1/metrics/messages/sent",
  "$SYS/brokers/emqx@127.0.0.1/metrics/bytes/received",
  "$SYS/brokers/emqx@127.0.0.1/metrics/bytes/sent",
  "$SYS/brokers/emqx@127.0.0.1/stats/subscriptions/count",
  "$SYS/brokers/emqx@127.0.0.1/stats/retained/count",
  "$SYS/brokers/emqx@127.0.0.1/uptime",
  "$SYS/brokers/emqx@127.0.0.1/version",
];

// EMQX 4.x kept dots in stats topics (metrics topics used slashes there too).
const EMQX4_STATS_TOPICS = [
  "$SYS/brokers/emqx@node1.emqx.io/stats/connections.count",
  "$SYS/brokers/emqx@node1.emqx.io/stats/subscriptions.count",
  "$SYS/brokers/emqx@node1.emqx.io/stats/retained.count",
];

// VerneMQ systree: $SYS/<node>/ + metric name split on "_".
const VERNEMQ_TOPICS = [
  "$SYS/VerneMQ@127.0.0.1/total/active/connections",
  "$SYS/VerneMQ@127.0.0.1/mqtt/publish/received",
  "$SYS/VerneMQ@127.0.0.1/mqtt/publish/sent",
  "$SYS/VerneMQ@127.0.0.1/bytes/received",
  "$SYS/VerneMQ@127.0.0.1/bytes/sent",
  "$SYS/VerneMQ@127.0.0.1/router/subscriptions",
  "$SYS/VerneMQ@127.0.0.1/retain/messages",
  "$SYS/VerneMQ@127.0.0.1/system/wallclock",
];

describe("topicMatchesPattern", () => {
  it("matches exact topics", () => {
    expect(
      topicMatchesPattern(
        "$SYS/broker/clients/connected",
        "$SYS/broker/clients/connected"
      )
    ).toBe(true);
  });

  it("matches a topic level containing a literal space", () => {
    expect(
      topicMatchesPattern(
        "$SYS/broker/retained messages/count",
        "$SYS/broker/retained messages/count"
      )
    ).toBe(true);
  });

  it("+ matches exactly one level, including @-containing node names", () => {
    expect(
      topicMatchesPattern(
        "$SYS/brokers/+/stats/connections/count",
        "$SYS/brokers/emqx@127.0.0.1/stats/connections/count"
      )
    ).toBe(true);
    expect(
      topicMatchesPattern(
        "$SYS/+/system/wallclock",
        "$SYS/VerneMQ@127.0.0.1/system/wallclock"
      )
    ).toBe(true);
  });

  it("+ does not span multiple levels", () => {
    expect(
      topicMatchesPattern("$SYS/+/uptime", "$SYS/brokers/node1/uptime")
    ).toBe(false);
  });

  it("rejects length mismatches in either direction", () => {
    expect(topicMatchesPattern("$SYS/broker/uptime", "$SYS/broker")).toBe(
      false
    );
    expect(
      topicMatchesPattern("$SYS/broker/uptime", "$SYS/broker/uptime/extra")
    ).toBe(false);
  });

  it("# matches zero or more trailing levels", () => {
    expect(
      topicMatchesPattern(
        "$SYS/broker/load/#",
        "$SYS/broker/load/messages/received/1min"
      )
    ).toBe(true);
    // Also matches the parent (zero remaining levels) and one level deep.
    expect(topicMatchesPattern("a/#", "a")).toBe(true);
    expect(topicMatchesPattern("a/#", "a/b")).toBe(true);
    expect(topicMatchesPattern("a/#", "a/b/c")).toBe(true);
  });

  it("# alone matches everything", () => {
    expect(topicMatchesPattern("#", "$SYS/broker/uptime")).toBe(true);
    expect(topicMatchesPattern("#", "anything")).toBe(true);
  });

  it("# still requires the earlier levels to match", () => {
    expect(topicMatchesPattern("a/#", "b/x")).toBe(false);
  });

  it("+ behavior is unchanged alongside # support", () => {
    expect(
      topicMatchesPattern(
        "$SYS/brokers/+/stats/connections/count",
        "$SYS/brokers/emqx@127.0.0.1/stats/connections/count"
      )
    ).toBe(true);
    expect(
      topicMatchesPattern("$SYS/+/uptime", "$SYS/brokers/node1/uptime")
    ).toBe(false);
  });
});

describe("selectCandidate", () => {
  it("resolves every numeric builtin against mosquitto topics", () => {
    for (const key of [
      "clients_connected",
      "msg_rate_in",
      "msg_rate_out",
      "bytes_rate_in",
      "bytes_rate_out",
      "subscriptions",
      "retained",
      "uptime",
      "version",
    ]) {
      const selected = selectCandidate(builtin(key), MOSQUITTO_TOPICS);
      expect(selected, key).not.toBeNull();
      expect(selected?.topic.startsWith("$SYS/broker/"), key).toBe(true);
    }
  });

  it("resolves every builtin against EMQX 5 topics", () => {
    for (const key of [
      "clients_connected",
      "msg_rate_in",
      "msg_rate_out",
      "bytes_rate_in",
      "bytes_rate_out",
      "subscriptions",
      "retained",
      "uptime",
      "version",
    ]) {
      const selected = selectCandidate(builtin(key), EMQX5_TOPICS);
      expect(selected, key).not.toBeNull();
      expect(selected?.topic.startsWith("$SYS/brokers/"), key).toBe(true);
    }
  });

  it("resolves EMQX 4 dotted stats topics", () => {
    for (const key of ["clients_connected", "subscriptions", "retained"]) {
      const selected = selectCandidate(builtin(key), EMQX4_STATS_TOPICS);
      expect(selected, key).not.toBeNull();
    }
  });

  it("resolves VerneMQ topics for everything except version", () => {
    for (const key of [
      "clients_connected",
      "msg_rate_in",
      "msg_rate_out",
      "bytes_rate_in",
      "bytes_rate_out",
      "subscriptions",
      "retained",
      "uptime",
    ]) {
      const selected = selectCandidate(builtin(key), VERNEMQ_TOPICS);
      expect(selected, key).not.toBeNull();
      expect(selected?.topic.startsWith("$SYS/VerneMQ@"), key).toBe(true);
    }
    expect(selectCandidate(builtin("version"), VERNEMQ_TOPICS)).toBeNull();
  });

  it("EMQX rate candidates are cumulative; VerneMQ counters too", () => {
    expect(
      selectCandidate(builtin("msg_rate_in"), EMQX5_TOPICS)?.candidate.kind
    ).toBe("cumulative");
    expect(
      selectCandidate(builtin("bytes_rate_out"), VERNEMQ_TOPICS)?.candidate.kind
    ).toBe("cumulative");
  });

  it("prefers the earlier candidate when several have data", () => {
    // mosquitto publishes both load/bytes/received/1min (gauge avg) and the
    // cumulative bytes/received; the 1min average is listed first and wins.
    const selected = selectCandidate(builtin("bytes_rate_in"), MOSQUITTO_TOPICS);
    expect(selected?.topic).toBe("$SYS/broker/load/bytes/received/1min");
    expect(selected?.candidate.kind).toBe("gauge");
  });

  it("falls back to mosquitto's cumulative counter when no 1min average", () => {
    const selected = selectCandidate(builtin("bytes_rate_in"), [
      "$SYS/broker/bytes/received",
    ]);
    expect(selected?.topic).toBe("$SYS/broker/bytes/received");
    expect(selected?.candidate.kind).toBe("cumulative");
  });

  it("picks the lexicographically smallest topic on multi-node clusters", () => {
    const selected = selectCandidate(builtin("clients_connected"), [
      "$SYS/brokers/emqx@node2/stats/connections/count",
      "$SYS/brokers/emqx@node1/stats/connections/count",
    ]);
    expect(selected?.topic).toBe(
      "$SYS/brokers/emqx@node1/stats/connections/count"
    );
  });

  it("returns null when nothing matches", () => {
    expect(selectCandidate(builtin("uptime"), ["foo/bar"])).toBeNull();
    expect(selectCandidate(builtin("observed_msg_rate"), MOSQUITTO_TOPICS)).toBeNull();
  });
});

describe("parseSample", () => {
  const gauge = { pattern: "t", payloadPath: "", kind: "gauge" as const };

  it("parses mosquitto integer and float strings", () => {
    expect(parseSample(gauge, "42")).toEqual({ kind: "number", value: 42 });
    expect(parseSample(gauge, "1234.5")).toEqual({
      kind: "number",
      value: 1234.5,
    });
  });

  it("parses EMQX bare integer payloads", () => {
    expect(parseSample(gauge, "1830")).toEqual({ kind: "number", value: 1830 });
  });

  it("parses VerneMQ float_to_binary scientific notation", () => {
    expect(parseSample(gauge, "2.30000000000000000000e+01")).toEqual({
      kind: "number",
      value: 23,
    });
  });

  it("extracts a JSON path when payloadPath is set", () => {
    const c = { ...gauge, payloadPath: "stats.count" };
    expect(parseSample(c, '{"stats":{"count":7}}')).toEqual({
      kind: "number",
      value: 7,
    });
  });

  it("scales mosquitto 1min per-minute averages to per-second", () => {
    const selected = selectCandidate(builtin("msg_rate_in"), MOSQUITTO_TOPICS);
    expect(selected).not.toBeNull();
    const sample = parseSample(selected!.candidate, "600.30");
    expect(sample.kind).toBe("number");
    expect((sample as { value: number }).value).toBeCloseTo(600.3 / 60, 10);
  });

  it("parses mosquitto uptime strings as seconds", () => {
    const selected = selectCandidate(builtin("uptime"), MOSQUITTO_TOPICS)!;
    expect(parseSample(selected.candidate, "3672 seconds")).toEqual({
      kind: "number",
      value: 3672,
    });
    expect(parseSample(selected.candidate, "1 second")).toEqual({
      kind: "number",
      value: 1,
    });
  });

  it("parses EMQX 5 uptime milliseconds into seconds", () => {
    const selected = selectCandidate(builtin("uptime"), EMQX5_TOPICS)!;
    expect(parseSample(selected.candidate, "13226000")).toEqual({
      kind: "number",
      value: 13226,
    });
  });

  it("passes EMQX 4 human uptime strings through as text", () => {
    const selected = selectCandidate(builtin("uptime"), EMQX5_TOPICS)!;
    expect(
      parseSample(selected.candidate, "28 days, 15 hours, 27 minutes, 12 seconds")
    ).toEqual({
      kind: "text",
      text: "28 days, 15 hours, 27 minutes, 12 seconds",
    });
  });

  it("parses VerneMQ wallclock milliseconds into seconds", () => {
    const selected = selectCandidate(builtin("uptime"), VERNEMQ_TOPICS)!;
    expect(parseSample(selected.candidate, "7380000")).toEqual({
      kind: "number",
      value: 7380,
    });
  });

  it("passes version strings through untrimmed of content", () => {
    const mosquitto = selectCandidate(builtin("version"), MOSQUITTO_TOPICS)!;
    expect(parseSample(mosquitto.candidate, "mosquitto version 2.0.18")).toEqual(
      { kind: "text", text: "mosquitto version 2.0.18" }
    );
    const emqx = selectCandidate(builtin("version"), EMQX5_TOPICS)!;
    expect(parseSample(emqx.candidate, "5.8.4")).toEqual({
      kind: "text",
      text: "5.8.4",
    });
  });

  it("falls back to raw text for non-numeric payloads — never NaN", () => {
    expect(parseSample(gauge, "not a number")).toEqual({
      kind: "text",
      text: "not a number",
    });
    expect(parseSample(gauge, "")).toEqual({ kind: "text", text: "" });
    expect(parseSample({ ...gauge, payloadPath: "missing" }, '{"a":1}')).toEqual(
      { kind: "text", text: '{"a":1}' }
    );
  });
});

describe("mergeMappings", () => {
  it("returns the builtins as-is with no mappings", () => {
    const tiles = mergeMappings([]);
    expect(tiles.map((t) => t.key)).toEqual(BUILTIN_METRICS.map((t) => t.key));
    expect(tiles.at(-2)?.computed).toBe(true);
    expect(tiles.at(-1)?.computed).toBe(true);
  });

  it("override rows replace a builtin's candidates with the exact topic/path", () => {
    const tiles = mergeMappings([
      mappingRow({
        metricKey: "clients_connected",
        topic: "my/broker/clients",
        payloadPath: "count",
      }),
    ]);
    const tile = tiles.find((t) => t.key === "clients_connected")!;
    expect(tile.candidates).toEqual([
      { pattern: "my/broker/clients", payloadPath: "count", kind: "gauge" },
    ]);
    // Label falls back to the builtin's, position is unchanged.
    expect(tile.label).toBe("Connected clients");
    expect(tiles.findIndex((t) => t.key === "clients_connected")).toBe(
      BUILTIN_METRICS.findIndex((t) => t.key === "clients_connected")
    );
  });

  it("override uses the builtin's overrideKind and honors label/unit", () => {
    const tiles = mergeMappings([
      mappingRow({
        metricKey: "uptime",
        label: "Alive for",
        topic: "custom/uptime",
      }),
      mappingRow({
        metricKey: "retained",
        topic: "custom/retained",
        unit: "msgs",
      }),
    ]);
    const uptime = tiles.find((t) => t.key === "uptime")!;
    expect(uptime.candidates[0].kind).toBe("duration");
    expect(uptime.label).toBe("Alive for");
    const retained = tiles.find((t) => t.key === "retained")!;
    expect(retained.unit).toBe("msgs");
  });

  it("last override by sortOrder wins for the same metricKey", () => {
    const tiles = mergeMappings([
      mappingRow({ metricKey: "subscriptions", topic: "a", sortOrder: 2 }),
      mappingRow({ metricKey: "subscriptions", topic: "b", sortOrder: 1 }),
    ]);
    const tile = tiles.find((t) => t.key === "subscriptions")!;
    expect(tile.candidates[0].pattern).toBe("a");
  });

  it("custom rows append after builtins, ordered by sortOrder", () => {
    const tiles = mergeMappings([
      mappingRow({ label: "Second", topic: "t/2", sortOrder: 5 }),
      mappingRow({ label: "First", topic: "t/1", sortOrder: 1 }),
    ]);
    const customs = tiles.slice(BUILTIN_METRICS.length);
    expect(customs.map((t) => t.label)).toEqual(["First", "Second"]);
    expect(customs[0].candidates).toEqual([
      { pattern: "t/1", payloadPath: "", kind: "gauge" },
    ]);
    expect(customs[0].key).not.toBe(customs[1].key);
  });

  it("custom tiles fall back to the topic as label", () => {
    const tiles = mergeMappings([mappingRow({ topic: "plant/temp" })]);
    expect(tiles.at(-1)?.label).toBe("plant/temp");
  });

  it("keeps rows with an unknown metricKey as custom tiles", () => {
    const tiles = mergeMappings([
      mappingRow({ metricKey: "no_such_builtin", topic: "t/x", label: "X" }),
    ]);
    expect(tiles).toHaveLength(BUILTIN_METRICS.length + 1);
    expect(tiles.at(-1)?.label).toBe("X");
  });

  it("keys custom tiles by row id when present, stable across sibling deletes", () => {
    const rows = [
      mappingRow({ id: 10, topic: "t/1", label: "First", sortOrder: 1 }),
      mappingRow({ id: 20, topic: "t/2", label: "Second", sortOrder: 2 }),
    ];
    const before = mergeMappings(rows).slice(BUILTIN_METRICS.length);
    expect(before.map((t) => t.key)).toEqual(["custom:10", "custom:20"]);

    // Deleting the first row must not renumber the survivor's key.
    const after = mergeMappings([rows[1]]).slice(BUILTIN_METRICS.length);
    expect(after.map((t) => t.key)).toEqual(["custom:20"]);
  });

  it("falls back to topic#path keys for id-less rows", () => {
    const tiles = mergeMappings([
      mappingRow({ topic: "plant/temp", payloadPath: "data.c" }),
    ]);
    expect(tiles.at(-1)?.key).toBe("custom:plant/temp#data.c");
  });
});

// --- v2 registry: hidden/overrideTarget flags + new metric bindings ----------

// mosquitto 2.x $SYS leaves for the v2 diagnostic metrics.
const MOSQUITTO_V2_TOPICS = [
  "$SYS/broker/load/publish/dropped/1min",
  "$SYS/broker/packet/out/count",
  "$SYS/broker/heap/current",
  "$SYS/broker/heap/maximum",
  "$SYS/broker/store/messages/count",
  "$SYS/broker/store/messages/bytes",
  "$SYS/broker/clients/disconnected",
  "$SYS/broker/clients/expired",
  "$SYS/broker/load/sockets/1min",
  "$SYS/broker/load/messages/received/5min",
  "$SYS/broker/load/messages/received/15min",
  "$SYS/broker/load/messages/sent/5min",
  "$SYS/broker/load/messages/sent/15min",
  "$SYS/broker/messages/received",
  "$SYS/broker/messages/sent",
];

// aedes-stats publishes under $SYS/<random-id>/… with `+`-matched heap leaves.
const AEDES_TOPICS = [
  "$SYS/aedes8f3a/memory/heap/current",
  "$SYS/aedes8f3a/memory/heap/maximum",
];

describe("v2 registry flags", () => {
  it("marks the relocated v1 builtins hidden but keeps them override targets", () => {
    for (const key of ["msg_rate_in", "msg_rate_out", "uptime", "version"]) {
      const t = builtin(key);
      expect(t.hidden, key).toBe(true);
      expect(t.overrideTarget, key).not.toBe(false); // still an override target
    }
  });

  it("keeps bytes_rate_* and the core gauges visible (not hidden)", () => {
    for (const key of [
      "clients_connected",
      "bytes_rate_in",
      "bytes_rate_out",
      "subscriptions",
      "retained",
    ]) {
      expect(builtin(key).hidden, key).not.toBe(true);
    }
  });

  it("marks every new diagnostic metric hidden and not an override target", () => {
    for (const key of [
      "msgs_dropped",
      "delivery_backlog",
      "heap_current",
      "heap_max",
      "store_msgs",
      "store_bytes",
      "clients_disconnected",
      "clients_expired",
      "sockets_1min",
      "messages_received_total",
      "messages_sent_total",
      "fan_out",
      "avg_msg_size",
    ]) {
      const t = builtin(key);
      expect(t.hidden, key).toBe(true);
      expect(t.overrideTarget, key).toBe(false);
    }
  });

  it("keeps the observed computed tiles last (facts/derived slot in between)", () => {
    expect(BUILTIN_METRICS.at(-1)?.key).toBe("observed_byte_rate");
    expect(BUILTIN_METRICS.at(-2)?.key).toBe("observed_msg_rate");
  });
});

describe("v2 metric bindings", () => {
  it("binds every new diagnostic metric to its exact mosquitto candidate", () => {
    const expected: Record<string, string> = {
      msgs_dropped: "$SYS/broker/load/publish/dropped/1min",
      delivery_backlog: "$SYS/broker/packet/out/count",
      heap_current: "$SYS/broker/heap/current",
      heap_max: "$SYS/broker/heap/maximum",
      store_msgs: "$SYS/broker/store/messages/count",
      store_bytes: "$SYS/broker/store/messages/bytes",
      clients_disconnected: "$SYS/broker/clients/disconnected",
      clients_expired: "$SYS/broker/clients/expired",
      sockets_1min: "$SYS/broker/load/sockets/1min",
      messages_received_total: "$SYS/broker/messages/received",
      messages_sent_total: "$SYS/broker/messages/sent",
    };
    for (const [key, topic] of Object.entries(expected)) {
      const sel = selectCandidate(builtin(key), MOSQUITTO_V2_TOPICS);
      expect(sel?.topic, key).toBe(topic);
    }
  });

  it("scales the mosquitto drop average to drops/s and treats it as a gauge", () => {
    const sel = selectCandidate(builtin("msgs_dropped"), MOSQUITTO_V2_TOPICS)!;
    expect(sel.candidate.kind).toBe("gauge");
    // 120 dropped/min → 2 dropped/s.
    const sample = parseSample(sel.candidate, "120");
    expect(sample).toEqual({ kind: "number", value: 2 });
  });

  it("treats delivery_backlog (packet/out/count) as a gauge, not a counter", () => {
    // mosquitto-8: a queue length that legitimately plateaus on an idle broker.
    // If it were mis-typed cumulative, a flat value would derive a 0 rate and a
    // rising queue would be lost. Assert the gauge kind so the idle plateau is
    // read at face value.
    const sel = selectCandidate(builtin("delivery_backlog"), MOSQUITTO_V2_TOPICS)!;
    expect(sel.candidate.kind).toBe("gauge");
    expect(parseSample(sel.candidate, "0")).toEqual({ kind: "number", value: 0 });
  });

  it("derives a rate from the cumulative message totals", () => {
    expect(
      selectCandidate(builtin("messages_received_total"), MOSQUITTO_V2_TOPICS)
        ?.candidate.kind
    ).toBe("cumulative");
    expect(
      selectCandidate(builtin("messages_sent_total"), MOSQUITTO_V2_TOPICS)
        ?.candidate.kind
    ).toBe("cumulative");
  });

  it("binds aedes heap via the + wildcard candidate", () => {
    const cur = selectCandidate(builtin("heap_current"), AEDES_TOPICS);
    expect(cur?.topic).toBe("$SYS/aedes8f3a/memory/heap/current");
    const max = selectCandidate(builtin("heap_max"), AEDES_TOPICS);
    expect(max?.topic).toBe("$SYS/aedes8f3a/memory/heap/maximum");
  });

  it("does not cross-family mislabel: mosquitto heap ignores aedes-only leaves", () => {
    // A mosquitto broker with only its own heap leaf must not resolve via the
    // aedes `+/memory/heap/current` wildcard onto some unrelated topic.
    const sel = selectCandidate(builtin("heap_current"), [
      "$SYS/broker/heap/current",
    ]);
    expect(sel?.topic).toBe("$SYS/broker/heap/current");
    // And an unrelated node topic must not satisfy the exact mosquitto slot.
    expect(
      selectCandidate(builtin("delivery_backlog"), [
        "$SYS/broker/packet/received",
      ])
    ).toBeNull();
  });

  it("does not bind heap to Mochi's process-memory topic", () => {
    // Mochi's system/memory is process memory, deliberately unbound.
    expect(
      selectCandidate(builtin("heap_current"), ["$SYS/broker/system/memory"])
    ).toBeNull();
  });
});

describe("humanizeDuration", () => {
  it("formats sub-minute durations", () => {
    expect(humanizeDuration(45)).toBe("45s");
    expect(humanizeDuration(0)).toBe("0s");
  });

  it("formats minutes and hours with two significant units", () => {
    expect(humanizeDuration(123)).toBe("2m 3s");
    expect(humanizeDuration(7380)).toBe("2h 3m");
    expect(humanizeDuration(3672)).toBe("1h 1m");
  });

  it("formats days and drops a zero second unit", () => {
    expect(humanizeDuration(90000)).toBe("1d 1h");
    expect(humanizeDuration(7200)).toBe("2h");
    expect(humanizeDuration(86400)).toBe("1d");
  });

  it("floors fractional seconds and clamps negatives", () => {
    expect(humanizeDuration(59.9)).toBe("59s");
    expect(humanizeDuration(-5)).toBe("0s");
  });
});

describe("formatMetricValue", () => {
  it("keeps small numbers unabbreviated", () => {
    expect(formatMetricValue(0)).toBe("0");
    expect(formatMetricValue(42)).toBe("42");
    expect(formatMetricValue(950)).toBe("950");
  });

  it("rounds to at most one decimal", () => {
    expect(formatMetricValue(42.567)).toBe("42.6");
    expect(formatMetricValue(42.0)).toBe("42");
  });

  it("abbreviates with SI suffixes", () => {
    expect(formatMetricValue(1234)).toBe("1.2k");
    expect(formatMetricValue(12345)).toBe("12.3k");
    expect(formatMetricValue(3_400_000)).toBe("3.4M");
    expect(formatMetricValue(7_100_000_000)).toBe("7.1G");
    expect(formatMetricValue(2_500_000_000_000)).toBe("2.5T");
  });

  it("promotes values that round into the next tier", () => {
    expect(formatMetricValue(999_950)).toBe("1M");
  });

  it("handles negatives", () => {
    expect(formatMetricValue(-1234)).toBe("-1.2k");
    expect(formatMetricValue(-42.34)).toBe("-42.3");
  });
});
