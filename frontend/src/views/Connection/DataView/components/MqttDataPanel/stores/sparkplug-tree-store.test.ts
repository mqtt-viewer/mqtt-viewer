import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

// --- Mocks (hoisted so the vi.mock factories can see them) --------------------

const mocks = vi.hoisted(() => ({
  getSparkplugHistory: vi.fn(),
  handlers: new Map<string, Set<(e: any) => void>>(),
}));

vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: (name: string, cb: (e: any) => void) => {
      const set = mocks.handlers.get(name) ?? new Set();
      set.add(cb);
      mocks.handlers.set(name, set);
      return () => mocks.handlers.get(name)?.delete(cb);
    },
  },
}));

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetSparkplugMessageHistory: mocks.getSparkplugHistory,
  GetSparkplugSuspendedOrd: async () => 0,
}));

import {
  createSparkplugTreeStore,
  WARNING_CAP,
  TICKER_MS,
  BACKFILL_IDLE_MS,
  MAX_TRACKED_NODES,
  MAX_TRACKED_DEVICES,
  MAX_PLACEHOLDER_METRICS,
  MAX_TRACKED_HOSTS,
  type SparkplugTreeState,
  type SparkplugNode,
} from "./sparkplug-tree-store";

// --- Helpers ------------------------------------------------------------------

const CONN = 7;

const eventSet = {
  mqttConnected: "conn",
  mqttDisconnected: "disc",
  mqttConnecting: "connecting",
  mqttReconnecting: "reconnecting",
  mqttClientError: "err",
  mqttMessages: "msgs",
  mqttLatency: "latency",
  mqttClearHistory: "clear",
} as any;

const emit = (name: string, data?: any) => {
  for (const cb of Array.from(mocks.handlers.get(name) ?? [])) cb({ data });
};

const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");

/** Wraps messages as GetSparkplugMessageHistory returns them. */
const history = (messages: any[], suspendedOrd = 0) => ({ messages, suspendedOrd });

let nextId = 1;
const msg = (
  topic: string,
  payload: string,
  timeMs: number,
  sparkplug?: Record<string, any>
) => {
    const id = nextId++;
    return {
      id: String(id),
      topic,
      payload: b64(payload),
      qos: 0,
      retain: false,
      timeMs,
      // The backend's arrival order: time order, ties broken by creation.
      middlewareProperties: sparkplug
        ? { sparkplug: { n: timeMs * 1000 + (id % 1000), ...sparkplug } }
        : null,
    } as any;
  };

// Sparkplug message builders. The payload is the backend's protojson form
// (names already injected for resolved data messages).
const nbirth = (
  timeMs: number,
  opts: {
    group?: string;
    node?: string;
    bdSeq?: number;
    metrics?: any[];
  } = {}
) => {
  const group = opts.group ?? "EnergyCo";
  const node = opts.node ?? "substation-7";
  const metrics = opts.metrics ?? [
    {
      name: "bdSeq",
      datatype: 8,
      longValue: String(opts.bdSeq ?? 0),
      timestamp: String(timeMs),
    },
    { name: "Volts/L1", alias: "3", datatype: 9, floatValue: 239.5, timestamp: String(timeMs) },
    { name: "Amps/L1", alias: "5", datatype: 9, floatValue: 12.9, timestamp: String(timeMs) },
  ];
  const meta: Record<string, any> = {
    msgType: "NBIRTH",
    group,
    edgeNode: node,
  };
  if (opts.bdSeq !== undefined) meta.bdSeq = opts.bdSeq;
  return msg(
    `spBv1.0/${group}/NBIRTH/${node}`,
    JSON.stringify({ timestamp: String(timeMs), metrics, seq: "0" }),
    timeMs,
    meta
  );
};

const ndata = (
  timeMs: number,
  opts: {
    group?: string;
    node?: string;
    metrics?: any[];
    seqGap?: { expected: number; got: number };
    resolution?: string;
    birthAtMs?: number;
    carriedOver?: boolean;
  } = {}
) => {
  const group = opts.group ?? "EnergyCo";
  const node = opts.node ?? "substation-7";
  const metrics = opts.metrics ?? [
    { name: "Volts/L1", alias: "3", floatValue: 240.1, timestamp: String(timeMs) },
  ];
  const meta: Record<string, any> = {
    msgType: "NDATA",
    group,
    edgeNode: node,
    resolution: opts.resolution ?? "resolved",
  };
  if (opts.seqGap) meta.seqGap = opts.seqGap;
  if (opts.birthAtMs !== undefined) meta.birthAtMs = opts.birthAtMs;
  if (opts.carriedOver) meta.carriedOver = true;
  return msg(
    `spBv1.0/${group}/NDATA/${node}`,
    JSON.stringify({ timestamp: String(timeMs), metrics, seq: "1" }),
    timeMs,
    meta
  );
};

const dbirth = (timeMs: number, device = "meter-01") =>
  msg(
    `spBv1.0/EnergyCo/DBIRTH/substation-7/${device}`,
    JSON.stringify({
      timestamp: String(timeMs),
      metrics: [
        { name: "Energy/kWh", alias: "1", datatype: 10, doubleValue: 48211.4, timestamp: String(timeMs) },
      ],
      seq: "2",
    }),
    timeMs,
    { msgType: "DBIRTH", group: "EnergyCo", edgeNode: "substation-7", device }
  );

const ddata = (timeMs: number, device = "meter-01", metrics?: any[]) =>
  msg(
    `spBv1.0/EnergyCo/DDATA/substation-7/${device}`,
    JSON.stringify({
      timestamp: String(timeMs),
      metrics: metrics ?? [
        { name: "Energy/kWh", alias: "1", doubleValue: 48212.9, timestamp: String(timeMs) },
      ],
      seq: "3",
    }),
    timeMs,
    {
      msgType: "DDATA",
      group: "EnergyCo",
      edgeNode: "substation-7",
      device,
      resolution: "resolved",
    }
  );

const ndeath = (timeMs: number, node = "substation-7", bdSeq?: number) => {
  const meta: Record<string, any> = {
    msgType: "NDEATH",
    group: "EnergyCo",
    edgeNode: node,
  };
  if (bdSeq !== undefined) meta.bdSeq = bdSeq;
  return msg(`spBv1.0/EnergyCo/NDEATH/${node}`, "", timeMs, meta);
};

const findNode = (
  state: SparkplugTreeState,
  group: string,
  name: string
): SparkplugNode => {
  const g = state.groups.find((x) => x.name === group);
  if (!g) throw new Error(`no group ${group}`);
  const n = g.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node ${name} in ${group}`);
  return n;
};

const BASE_MS = 1_000_000_000;

// The backfill is deferred and single-shot; most tests want it already
// settled so live emits fold in synchronously.
const makeStore = async () => {
  const store = createSparkplugTreeStore(CONN, eventSet);
  store.init();
  await store.activate();
  return store;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE_MS));
  mocks.handlers.clear();
  mocks.getSparkplugHistory.mockReset().mockResolvedValue(history([]));
  nextId = 1;
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests --------------------------------------------------------------------

describe("createSparkplugTreeStore — births and datas", () => {
  it("builds the node metric list from an NBIRTH and updates it from NDATA", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);

    let node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.online).toBe(true);
    expect(node.hasBirth).toBe(true);
    expect(node.birthAtMs).toBe(BASE_MS);
    const volts = node.metrics.find((m) => m.name === "Volts/L1");
    expect(volts).toBeDefined();
    expect(volts!.typeName).toBe("Float");
    expect(volts!.value).toBe("239.5");
    expect(volts!.placeholder).toBe(false);

    emit("msgs", [ndata(BASE_MS + 1000)]);
    node = findNode(get(store), "EnergyCo", "substation-7");
    const updated = node.metrics.find((m) => m.name === "Volts/L1")!;
    expect(updated.value).toBe("240.1");
    expect(updated.lastSeenMs).toBe(BASE_MS + 1000);
    expect(updated.payloadTsMs).toBe(BASE_MS + 1000);
    // The birth-established type survives data updates that omit datatype.
    expect(updated.typeName).toBe("Float");
    store.destroy();
  });

  it("hides the bdSeq plumbing metric from the list but surfaces it on the node", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS, { bdSeq: 3 })]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.bdSeq).toBe(3);
    expect(node.metrics.some((m) => m.name === "bdSeq")).toBe(false);
    expect(node.metricCount).toBe(2);
    store.destroy();
  });

  it("renders alias_<n> placeholders for unresolved alias-only metrics", async () => {
    const store = await makeStore();
    // Data before any birth: names absent, only aliases.
    emit("msgs", [
      ndata(BASE_MS, {
        resolution: "unresolved",
        metrics: [{ alias: "3", floatValue: 1.5, timestamp: String(BASE_MS) }],
      }),
    ]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    const m = node.metrics.find((x) => x.name === "alias_3");
    expect(m).toBeDefined();
    expect(m!.placeholder).toBe(true);
    expect(node.hasBirth).toBe(false);
    store.destroy();
  });

  it("replaces (never merges) the metric set on a new birth", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    emit("msgs", [
      nbirth(BASE_MS + 1000, {
        metrics: [
          { name: "Temp", alias: "9", datatype: 9, floatValue: 21.0, timestamp: String(BASE_MS + 1000) },
        ],
      }),
    ]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.map((m) => m.name)).toEqual(["Temp"]);
    store.destroy();
  });

  it("keeps node and device metric sets separate", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS), dbirth(BASE_MS + 100)]);
    emit("msgs", [ddata(BASE_MS + 200)]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.some((m) => m.name === "Energy/kWh")).toBe(false);
    expect(node.devices).toHaveLength(1);
    const device = node.devices[0];
    expect(device.name).toBe("meter-01");
    expect(device.online).toBe(true);
    expect(device.metrics.find((m) => m.name === "Energy/kWh")!.value).toBe(
      "48212.9"
    );
    store.destroy();
  });

  it("shows exact values, keeping the raw value for copy", async () => {
    const store = await makeStore();
    emit("msgs", [
      ndata(BASE_MS, {
        metrics: [
          { name: "Pi", doubleValue: 3.14159265358979, timestamp: String(BASE_MS) },
          { name: "Energy", datatype: 10, doubleValue: 152340.5, timestamp: String(BASE_MS) },
          { name: "Big", longValue: "9007199254740993", timestamp: String(BASE_MS) },
          { name: "Null", isNull: true, timestamp: String(BASE_MS) },
        ],
      }),
    ]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    const pi = node.metrics.find((m) => m.name === "Pi")!;
    expect(pi.value).toBe("3.14159265358979");
    // Rounding to 6 significant digits used to show this as 152341.
    expect(node.metrics.find((m) => m.name === "Energy")!.value).toBe("152340.5");
    const big = node.metrics.find((m) => m.name === "Big")!;
    expect(big.value).toBe("9007199254740993");
    expect(big.valueRaw).toBe("9007199254740993");
    const nul = node.metrics.find((m) => m.name === "Null")!;
    expect(nul.value).toBe("null");
    expect(nul.isNull).toBe(true);
    store.destroy();
  });

  it("formats data values with the datatype declared in the birth", async () => {
    const store = await makeStore();
    emit("msgs", [
      nbirth(BASE_MS, {
        metrics: [
          { name: "Offset", alias: "1", datatype: 3, intValue: 0 },
          {
            name: "Temp",
            alias: "2",
            datatype: 9,
            floatValue: 20,
            properties: { keys: ["engUnit"], values: [{ type: 12, stringValue: "degC" }] },
          },
        ],
      }),
    ]);
    // NDATA omits datatype; -5 as an Int32 arrives as its two's complement.
    emit("msgs", [
      ndata(BASE_MS + 1000, {
        metrics: [
          { name: "Offset", alias: "1", intValue: 4294967291 },
          { name: "Temp", alias: "2", floatValue: 21.100000381469727 },
        ],
      }),
    ]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.find((m) => m.name === "Offset")!.value).toBe("-5");
    const temp = node.metrics.find((m) => m.name === "Temp")!;
    expect(temp.value).toBe("21.1");
    // The unit rides on the birth only and survives data updates.
    expect(temp.unit).toBe("degC");
    store.destroy();
  });

  it("flags metrics whose published quality is not good", async () => {
    const store = await makeStore();
    emit("msgs", [
      ndata(BASE_MS, {
        metrics: [
          {
            name: "Flow",
            datatype: 10,
            doubleValue: 1,
            properties: { keys: ["Quality"], values: [{ type: 3, intValue: 0 }] },
          },
          {
            name: "Level",
            datatype: 10,
            doubleValue: 2,
            properties: { keys: ["Quality"], values: [{ type: 3, intValue: 192 }] },
          },
        ],
      }),
    ]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.find((m) => m.name === "Flow")!.quality).toBe("bad");
    expect(node.metrics.find((m) => m.name === "Level")!.quality).toBeUndefined();
    store.destroy();
  });

  it("records the topic that last updated each metric", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS), ndata(BASE_MS + 1000)]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.find((m) => m.name === "Volts/L1")!.topic).toBe(
      "spBv1.0/EnergyCo/NDATA/substation-7"
    );
    expect(node.metrics.find((m) => m.name === "Amps/L1")!.topic).toBe(
      "spBv1.0/EnergyCo/NBIRTH/substation-7"
    );
    store.destroy();
  });
});

describe("createSparkplugTreeStore — seq gaps", () => {
  it("flags the node and appends a warning on a seq gap", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    emit("msgs", [ndata(BASE_MS + 1000, { seqGap: { expected: 41, got: 44 } })]);
    const state = get(store);
    const node = findNode(state, "EnergyCo", "substation-7");
    expect(node.seqOk).toBe(false);
    expect(node.lastSeqGap).toEqual({ expected: 41, got: 44 });
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).toMatchObject({
      node: "substation-7",
      text: "seq gap (expected 41, got 44)",
      kind: "seq-gap",
    });
    expect(state.warningCount).toBe(1);
    store.destroy();
  });

  it("dedupes consecutive identical gaps within the dedupe window", async () => {
    const store = await makeStore();
    emit("msgs", [
      ndata(BASE_MS, { seqGap: { expected: 41, got: 44 } }),
      ndata(BASE_MS + 1000, { seqGap: { expected: 41, got: 44 } }),
    ]);
    expect(get(store).warnings).toHaveLength(1);
    // A different gap is a new warning.
    emit("msgs", [ndata(BASE_MS + 2000, { seqGap: { expected: 50, got: 52 } })]);
    expect(get(store).warnings).toHaveLength(2);
    // The same gap again, but outside the window: warned again.
    emit("msgs", [ndata(BASE_MS + 60_000, { seqGap: { expected: 50, got: 52 } })]);
    expect(get(store).warnings).toHaveLength(3);
    store.destroy();
  });

  it("clears seqOk on a later birth", async () => {
    const store = await makeStore();
    emit("msgs", [ndata(BASE_MS, { seqGap: { expected: 1, got: 3 } })]);
    expect(findNode(get(store), "EnergyCo", "substation-7").seqOk).toBe(false);
    emit("msgs", [nbirth(BASE_MS + 1000)]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.seqOk).toBe(true);
    expect(node.lastSeqGap).toBeUndefined();
    store.destroy();
  });

  it("caps the warnings list at WARNING_CAP, keeping the newest", async () => {
    const store = await makeStore();
    const batch = [];
    for (let i = 0; i < WARNING_CAP + 10; i++) {
      batch.push(
        ndata(BASE_MS + i * 10_000, { seqGap: { expected: i, got: i + 2 } })
      );
    }
    emit("msgs", batch);
    const state = get(store);
    expect(state.warnings).toHaveLength(WARNING_CAP);
    expect(state.warnings[WARNING_CAP - 1].text).toContain(
      `expected ${WARNING_CAP + 9}`
    );
    store.destroy();
  });
});

describe("createSparkplugTreeStore — rebirth storms", () => {
  it("warns once when 4 births land within 90s, refreshing while it continues", async () => {
    const store = await makeStore();
    for (let i = 0; i < 3; i++) emit("msgs", [nbirth(BASE_MS + i * 10_000)]);
    expect(get(store).warnings).toHaveLength(0);

    emit("msgs", [nbirth(BASE_MS + 30_000)]); // 4th within 90s
    let state = get(store);
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).toMatchObject({
      node: "substation-7",
      kind: "rebirth-storm",
      text: "4 rebirths in 90s, possible duplicate client id",
    });

    // Storm continues: same warning refreshed (count + time), not duplicated.
    emit("msgs", [nbirth(BASE_MS + 40_000), nbirth(BASE_MS + 50_000)]);
    state = get(store);
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0].text).toBe(
      "6 rebirths in 90s, possible duplicate client id"
    );
    expect(state.warnings[0].timeMs).toBe(BASE_MS + 50_000);
    const node = findNode(state, "EnergyCo", "substation-7");
    expect(node.storm).toBe(true);
    store.destroy();
  });

  it("starts a fresh warning for a new storm after the last one subsided", async () => {
    const store = await makeStore();
    for (let i = 0; i < 4; i++) emit("msgs", [nbirth(BASE_MS + i * 10_000)]);
    expect(get(store).warnings).toHaveLength(1);

    // Quiet period: a lone birth 10 minutes later ends the storm.
    emit("msgs", [nbirth(BASE_MS + 630_000)]);
    expect(get(store).warnings).toHaveLength(1);

    // A second storm produces a second warning.
    for (let i = 1; i < 4; i++) {
      emit("msgs", [nbirth(BASE_MS + 630_000 + i * 10_000)]);
    }
    expect(get(store).warnings).toHaveLength(2);
    store.destroy();
  });

  it("does not count device births towards a node's storm", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    // A node birthing many devices at connect is normal, not a storm.
    emit("msgs", [
      dbirth(BASE_MS + 100, "d1"),
      dbirth(BASE_MS + 200, "d2"),
      dbirth(BASE_MS + 300, "d3"),
      dbirth(BASE_MS + 400, "d4"),
    ]);
    expect(get(store).warnings).toHaveLength(0);
    store.destroy();
  });
});

describe("createSparkplugTreeStore — deaths", () => {
  it("marks the node and its devices offline on NDEATH", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS), dbirth(BASE_MS + 100)]);
    emit("msgs", [ndeath(BASE_MS + 5000, "substation-7", 3)]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.online).toBe(false);
    expect(node.deathAtMs).toBe(BASE_MS + 5000);
    expect(node.bdSeq).toBe(3);
    expect(node.devices[0].online).toBe(false);
    // Metrics survive the death (the last-known values stay browsable).
    expect(node.metrics.length).toBeGreaterThan(0);
    store.destroy();
  });

  it("marks only the device offline on DDEATH", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS), dbirth(BASE_MS + 100)]);
    emit("msgs", [
      msg(
        "spBv1.0/EnergyCo/DDEATH/substation-7/meter-01",
        JSON.stringify({ timestamp: String(BASE_MS + 5000), seq: "4" }),
        BASE_MS + 5000,
        {
          msgType: "DDEATH",
          group: "EnergyCo",
          edgeNode: "substation-7",
          device: "meter-01",
        }
      ),
    ]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.online).toBe(true);
    expect(node.devices[0].online).toBe(false);
    expect(node.devices[0].deathAtMs).toBe(BASE_MS + 5000);
    store.destroy();
  });
});

describe("createSparkplugTreeStore — host STATE", () => {
  it("parses the Sparkplug 3.0 JSON form", async () => {
    const store = await makeStore();
    emit("msgs", [
      msg(
        "spBv1.0/STATE/scada-primary",
        JSON.stringify({ online: true, timestamp: BASE_MS - 500 }),
        BASE_MS,
        { msgType: "STATE", hostId: "scada-primary" }
      ),
    ]);
    const state = get(store);
    expect(state.hosts).toEqual([
      { hostId: "scada-primary", online: true, sinceMs: BASE_MS - 500 },
    ]);
    store.destroy();
  });

  it("parses the legacy plain-text form and tolerates junk", async () => {
    const store = await makeStore();
    emit("msgs", [
      msg("STATE/legacy-host", "OFFLINE", BASE_MS, {
        msgType: "STATE",
        hostId: "legacy-host",
      }),
      msg("STATE/junk-host", "\x00\x01 not a state", BASE_MS, {
        msgType: "STATE",
        hostId: "junk-host",
      }),
    ]);
    const state = get(store);
    expect(state.hosts).toEqual([
      { hostId: "legacy-host", online: false, sinceMs: BASE_MS },
    ]);
    store.destroy();
  });
});

describe("createSparkplugTreeStore — status", () => {
  it("treats a node that only sends data as online", async () => {
    // The mid-session case: births are rarely retained, so most nodes are
    // first seen through their data.
    const store = await makeStore();
    emit("msgs", [ndata(BASE_MS, { resolution: "unresolved", metrics: [{ alias: "3", floatValue: 1 }] })]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.status).toBe("online");
    expect(node.hasBirth).toBe(false);
    store.destroy();
  });

  it("brings a dead node back online on newer data", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS), ndeath(BASE_MS + 1000)]);
    expect(findNode(get(store), "EnergyCo", "substation-7").status).toBe("offline");
    emit("msgs", [ndata(BASE_MS + 2000, { resolution: "unresolved", metrics: [{ alias: "3", floatValue: 1 }] })]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.status).toBe("online");
    // The dead session's names are retired rather than shown beside the new
    // session's unresolved aliases.
    expect(node.metrics.map((m) => m.name)).toEqual(["alias_3"]);
    store.destroy();
  });

  it("does not age metrics into a warning state", async () => {
    // Sparkplug reports by exception: a metric that hasn't changed for an
    // hour is normal, so nothing flags it.
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    vi.advanceTimersByTime(3_600_000);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.status).toBe("online");
    expect(Object.keys(node.metrics[0])).not.toContain("stale");
    store.destroy();
  });
});

describe("createSparkplugTreeStore — gating, backfill, reset", () => {
  it("exposes hasSparkplug=false and writes nothing for non-Sparkplug batches", async () => {
    const store = await makeStore();
    let writes = 0;
    const unsub = store.subscribe(() => writes++);
    writes = 0;

    emit("msgs", [msg("factory/line0/temp", "21.4", BASE_MS)]);
    expect(writes).toBe(0); // non-Sparkplug batch: no store write at all
    expect(get(store).hasSparkplug).toBe(false);

    emit("msgs", [msg("plain/topic", "x", BASE_MS), nbirth(BASE_MS)]);
    expect(writes).toBe(1); // one coalesced write for the whole batch
    expect(get(store).hasSparkplug).toBe(true);
    unsub();
    store.destroy();
  });

  it("replays Sparkplug history once the backfill is triggered", async () => {
    mocks.getSparkplugHistory.mockResolvedValue(history([
      nbirth(BASE_MS - 10_000, { bdSeq: 1 }),
      ndata(BASE_MS - 5000),
      msg(
        "spBv1.0/STATE/scada-primary",
        JSON.stringify({ online: true, timestamp: BASE_MS - 20_000 }),
        BASE_MS - 20_000,
        { msgType: "STATE", hostId: "scada-primary" }
      ),
    ]));
    const store = await makeStore();
    const state = get(store);
    expect(state.hasSparkplug).toBe(true);
    expect(state.hosts).toHaveLength(1);
    const node = findNode(state, "EnergyCo", "substation-7");
    expect(node.metrics.find((m) => m.name === "Volts/L1")!.value).toBe("240.1");
    expect(mocks.getSparkplugHistory).toHaveBeenCalledWith(CONN);
    store.destroy();
  });

  it("keeps the store alive when the backfill rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getSparkplugHistory.mockRejectedValue(new Error("backend boom"));
    const store = createSparkplugTreeStore(CONN, eventSet);
    store.init();
    await expect(store.activate()).resolves.toBeUndefined();
    // Live traffic is still folded in after a failed backfill.
    emit("msgs", [nbirth(BASE_MS)]);
    expect(get(store).hasSparkplug).toBe(true);
    store.destroy();
    errSpy.mockRestore();
  });

  it("replays when the view opens, not on init or live traffic", async () => {
    const store = createSparkplugTreeStore(CONN, eventSet);
    store.init();
    emit("msgs", [nbirth(BASE_MS)]);
    await vi.advanceTimersByTimeAsync(BACKFILL_IDLE_MS * 2);
    expect(mocks.getSparkplugHistory).not.toHaveBeenCalled();

    await store.setActive(true);
    expect(mocks.getSparkplugHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getSparkplugHistory).toHaveBeenCalledWith(CONN);

    // Opening it again replays again: whatever arrived while it was hidden
    // was never decoded.
    await store.setActive(false);
    await store.setActive(true);
    expect(mocks.getSparkplugHistory).toHaveBeenCalledTimes(2);
    store.destroy();
  });

  it("while hidden, tracks warnings and liveness but builds no tree", async () => {
    const store = createSparkplugTreeStore(CONN, eventSet);
    store.init();
    emit("msgs", [nbirth(BASE_MS), ndata(BASE_MS + 100, { seqGap: { expected: 1, got: 3 } })]);
    let state = get(store);
    expect(state.hasSparkplug).toBe(true);
    expect(state.warningCount).toBe(1);
    expect(state.groups).toHaveLength(0);

    // Opening the view replays the backend's snapshot to fill the tree.
    mocks.getSparkplugHistory.mockResolvedValue(history([nbirth(BASE_MS), ndata(BASE_MS + 100)]));
    await store.setActive(true);
    state = get(store);
    const node = findNode(state, "EnergyCo", "substation-7");
    expect(node.metrics.find((m) => m.name === "Volts/L1")!.value).toBe("240.1");
    // The replayed gap message is the same one: not counted twice.
    expect(state.warningCount).toBe(1);
    store.destroy();
  });

  it("falls back to an idle backfill when no Sparkplug traffic arrives", async () => {
    const store = createSparkplugTreeStore(CONN, eventSet);
    store.init();
    expect(mocks.getSparkplugHistory).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(BACKFILL_IDLE_MS + 10);
    expect(mocks.getSparkplugHistory).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("drops the idle backfill timer on destroy", async () => {
    const store = createSparkplugTreeStore(CONN, eventSet);
    store.init();
    store.destroy();
    await vi.advanceTimersByTimeAsync(BACKFILL_IDLE_MS * 2);
    expect(mocks.getSparkplugHistory).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the traffic on the clear-history event and keeps the view", async () => {
    const store = await makeStore();
    emit("msgs", [
      nbirth(BASE_MS),
      ndata(BASE_MS + 100, { seqGap: { expected: 1, got: 3 } }),
    ]);
    expect(get(store).hasSparkplug).toBe(true);

    emit("clear");
    await vi.waitFor(() => expect(get(store).replaying).toBe(false));
    const state = get(store);
    // The view stays offered, and rebuilds from what the backend kept (here,
    // nothing).
    expect(state.hasSparkplug).toBe(true);
    expect(state.groups).toHaveLength(0);
    expect(state.hosts).toHaveLength(0);
    expect(state.warnings).toHaveLength(0);
    expect(state.warningCount).toBe(0);
    store.destroy();
  });

  it("discards a backfill whose clear-history landed mid-fetch", async () => {
    const resolvers: ((v: any) => void)[] = [];
    let signalCalled!: () => void;
    const called = new Promise<void>((r) => (signalCalled = r));
    mocks.getSparkplugHistory.mockImplementation(() => {
      signalCalled();
      return new Promise((res) => resolvers.push(res));
    });

    const store = createSparkplugTreeStore(CONN, eventSet);
    store.init();
    const backfillPromise = store.activate();
    await called; // fetch in flight; epoch captured

    // The clear starts a fresh replay for the open view; the old one lands
    // after it and must be discarded.
    emit("clear");
    expect(resolvers).toHaveLength(2);
    resolvers[1]({ messages: [], suspendedOrd: 0 });
    resolvers[0]({ messages: [nbirth(BASE_MS)], suspendedOrd: 0 });
    await backfillPromise;
    await vi.waitFor(() => expect(get(store).replaying).toBe(false));

    const state = get(store);
    expect(state.hasSparkplug).toBe(false);
    expect(state.groups).toHaveLength(0);
    store.destroy();
  });

  it("does not start the ticker when destroy() runs during an in-flight backfill", async () => {
    let resolveHist!: (v: any) => void;
    let signalCalled!: () => void;
    const called = new Promise<void>((r) => (signalCalled = r));
    mocks.getSparkplugHistory.mockImplementation(() => {
      signalCalled();
      return new Promise((res) => (resolveHist = res));
    });

    const store = createSparkplugTreeStore(CONN, eventSet);
    store.init();
    const backfillPromise = store.activate();
    await called; // fetch in flight

    store.destroy(); // torn down before the backfill resolves
    resolveHist([nbirth(BASE_MS)]);
    await backfillPromise;

    expect(vi.getTimerCount()).toBe(0); // no leaked ticker interval

    const snapshot = get(store);
    vi.advanceTimersByTime(TICKER_MS * 5);
    expect(get(store)).toBe(snapshot);
  });

  it("dedupes a message that arrives in both the backfill result and a live batch during backfill", async () => {
    let resolveHist!: (v: any) => void;
    let signalCalled!: () => void;
    const called = new Promise<void>((r) => (signalCalled = r));
    mocks.getSparkplugHistory.mockImplementation(() => {
      signalCalled();
      return new Promise((res) => (resolveHist = res));
    });

    const store = createSparkplugTreeStore(CONN, eventSet);
    store.init();
    const backfillPromise = store.activate();
    await called; // fetch in flight; epoch captured

    // Same message object arrives live AND will be in the resolved history.
    const shared = nbirth(BASE_MS, { node: "dup-node" });
    // Genuinely new: only ever seen live, never in history.
    const liveOnly = nbirth(BASE_MS + 10, { node: "live-only-node" });
    emit("msgs", [shared, liveOnly]);

    resolveHist([shared]);
    await backfillPromise;

    // If `shared` had been ingested twice its ring would hold 2 entries, and
    // two more distinct births would already make a storm of 4.
    emit("msgs", [
      nbirth(BASE_MS + 20, { node: "dup-node" }),
      nbirth(BASE_MS + 30, { node: "dup-node" }),
    ]);
    const state = get(store);
    expect(findNode(state, "EnergyCo", "dup-node").storm).toBe(false);

    const liveOnlyNode = findNode(state, "EnergyCo", "live-only-node");
    expect(liveOnlyNode.hasBirth).toBe(true);

    store.destroy();
  });

  it("unbinds listeners and stops the ticker on destroy", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    expect(vi.getTimerCount()).toBe(1);
    store.destroy();
    expect(vi.getTimerCount()).toBe(0);
    for (const name of ["msgs", "clear", "conn", "disc", "reconnecting"]) {
      expect(mocks.handlers.get(name)?.size ?? 0).toBe(0);
    }
    const snapshot = get(store);
    emit("msgs", [nbirth(BASE_MS + 1000)]);
    expect(get(store)).toBe(snapshot);
  });
});

describe("createSparkplugTreeStore — connection drops", () => {
  const dropAndReturn = (store: any, event = "reconnecting") => {
    vi.advanceTimersByTime(1000);
    emit(event);
    vi.advanceTimersByTime(5000);
    emit("conn");
  };

  it("keeps the tree through a drop but stops vouching for it", async () => {
    const store = await makeStore();
    emit("msgs", [
      nbirth(BASE_MS),
      dbirth(BASE_MS + 100),
      ndata(BASE_MS + 200, { seqGap: { expected: 1, got: 3 } }),
      msg(
        "spBv1.0/STATE/scada-primary",
        JSON.stringify({ online: true, timestamp: BASE_MS }),
        BASE_MS,
        { msgType: "STATE", hostId: "scada-primary" }
      ),
    ]);

    vi.advanceTimersByTime(1000);
    emit("reconnecting");
    let state = get(store);
    expect(state.connected).toBe(false);
    expect(state.droppedAtMs).toBe(BASE_MS + 1000);
    let node = findNode(state, "EnergyCo", "substation-7");
    // Values and warnings stay browsable.
    expect(node.metrics.length).toBeGreaterThan(0);
    expect(state.warnings).toHaveLength(1);
    expect(state.hosts).toHaveLength(1);
    // Nothing can be known while away.
    expect(node.status).toBe("unknown");
    expect(node.verified).toBe(false);
    // The clock freezes at the drop.
    const frozen = state.nowMs;
    vi.advanceTimersByTime(60_000);
    expect(store.snapshot().nowMs).toBe(frozen);

    emit("conn");
    state = get(store);
    node = findNode(state, "EnergyCo", "substation-7");
    // Back, but nothing heard from the node since the drop yet.
    expect(node.status).toBe("unknown");
    expect(node.hasBirth).toBe(true);
    expect(node.verified).toBe(false);
    store.destroy();
  });

  it("confirms a node online when it is heard from after the drop", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    dropAndReturn(store);
    emit("msgs", [ndata(Date.now(), { carriedOver: true })]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.status).toBe("online");
    // Names still come from the pre-drop birth.
    expect(node.verified).toBe(false);
    store.destroy();
  });

  it("verifies names again on a birth after the drop", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    dropAndReturn(store, "disc");
    emit("msgs", [nbirth(Date.now())]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.status).toBe("online");
    expect(node.verified).toBe(true);
    store.destroy();
  });

  it("marks names unverified from backend meta alone", async () => {
    // A drop that happened before this store was created is only known to
    // the backend, which flags the data it resolves from pre-drop births.
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS), ndata(BASE_MS + 1000, { carriedOver: true })]);
    expect(findNode(get(store), "EnergyCo", "substation-7").verified).toBe(false);
    store.destroy();
  });

  it("starts unknown when created while disconnected", async () => {
    // The backend reports its last drop, after the birth it replays.
    const birth = nbirth(BASE_MS - 10_000);
    mocks.getSparkplugHistory.mockResolvedValue({
      messages: [birth],
      suspendedOrd: (birth.middlewareProperties as any).sparkplug.n,
    });
    const store = createSparkplugTreeStore(CONN, eventSet, { connected: false });
    store.init();
    await store.activate();
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.status).toBe("unknown");
    expect(node.verified).toBe(false);
    store.destroy();
  });

  it("does not refetch history after a reconnect and resumes ticking", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    emit("reconnecting");
    expect(vi.getTimerCount()).toBe(0);
    emit("conn");
    expect(vi.getTimerCount()).toBe(1);
    expect(mocks.getSparkplugHistory).toHaveBeenCalledTimes(1);
    store.destroy();
  });
});

describe("createSparkplugTreeStore — stale deaths", () => {
  it("ignores an NDEATH from a superseded session", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS, { bdSeq: 5 }), dbirth(BASE_MS + 100)]);

    const stale = ndeath(BASE_MS + 200, "substation-7", 4);
    (stale.middlewareProperties as any).sparkplug.staleDeath = true;
    emit("msgs", [stale]);

    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.online).toBe(true);
    expect(node.deathAtMs).toBeUndefined();
    expect(node.bdSeq).toBe(5); // untouched by the stale death
    expect(node.devices[0].online).toBe(true);
    store.destroy();
  });
});

describe("createSparkplugTreeStore — caps", () => {
  it("drops new edge nodes past MAX_TRACKED_NODES, warning once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await makeStore();
    const batch: any[] = [];
    for (let i = 0; i < MAX_TRACKED_NODES + 5; i++) {
      batch.push(nbirth(BASE_MS, { node: `node-${i}` }));
    }
    expect(() => emit("msgs", batch)).not.toThrow();

    const state = get(store);
    const count = state.groups.reduce((a, g) => a + g.nodes.length, 0);
    expect(count).toBe(MAX_TRACKED_NODES);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("node cap reached");

    // Tracked nodes keep updating after the cap is hit.
    emit("msgs", [ndata(BASE_MS + 1000, { node: "node-0" })]);
    const first = findNode(get(store), "EnergyCo", "node-0");
    expect(first.metrics.find((m) => m.name === "Volts/L1")!.value).toBe("240.1");
    warnSpy.mockRestore();
    store.destroy();
  });

  it("drops new devices past MAX_TRACKED_DEVICES, warning once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    const batch: any[] = [];
    for (let i = 0; i < MAX_TRACKED_DEVICES + 3; i++) {
      batch.push(dbirth(BASE_MS + 1 + i, `device-${i}`));
    }
    expect(() => emit("msgs", batch)).not.toThrow();

    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.devices).toHaveLength(MAX_TRACKED_DEVICES);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("device cap reached");
    warnSpy.mockRestore();
    store.destroy();
  });

  it("caps placeholder alias metrics per scope but not real ones", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await makeStore();
    // An unbirthed publisher cycling aliases: unbounded distinct keys.
    const metrics = [];
    for (let i = 0; i < MAX_PLACEHOLDER_METRICS + 50; i++) {
      metrics.push({ alias: String(i), floatValue: i, timestamp: String(BASE_MS) });
    }
    emit("msgs", [ndata(BASE_MS, { resolution: "unresolved", metrics })]);

    let node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics).toHaveLength(MAX_PLACEHOLDER_METRICS);
    expect(node.metrics.every((m) => m.placeholder)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(
      "placeholder metric cap reached"
    );

    // A named metric is still accepted at the placeholder cap.
    emit("msgs", [ndata(BASE_MS + 1000)]);
    node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics).toHaveLength(MAX_PLACEHOLDER_METRICS + 1);

    // A birth resets the placeholder budget along with the metric map.
    emit("msgs", [nbirth(BASE_MS + 2000)]);
    node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics).toHaveLength(2);
    warnSpy.mockRestore();
    store.destroy();
  });
});

describe("createSparkplugTreeStore — duplicate delivery", () => {
  it("counts a seq-gap message once however often it is delivered", async () => {
    const store = await makeStore();
    const gapMsg = ndata(BASE_MS, { seqGap: { expected: 41, got: 44 } });
    emit("msgs", [gapMsg]);
    // A different gap in between clears the content dedupe...
    emit("msgs", [ndata(BASE_MS + 1000, { seqGap: { expected: 50, got: 52 } })]);
    expect(get(store).warnings).toHaveLength(2);
    // ...so only the message-id dedupe can catch this redelivery.
    emit("msgs", [gapMsg]);
    expect(get(store).warnings).toHaveLength(2);
    store.destroy();
  });

  it("does not inflate the rebirth count when one NBIRTH is redelivered", async () => {
    const store = await makeStore();
    const birth = nbirth(BASE_MS);
    for (let i = 0; i < 6; i++) emit("msgs", [birth]);
    // Three more distinct births make 4 only if the redeliveries were not
    // counted.
    emit("msgs", [nbirth(BASE_MS + 10), nbirth(BASE_MS + 20)]);
    const state = get(store);
    expect(findNode(state, "EnergyCo", "substation-7").storm).toBe(false);
    expect(state.warnings).toHaveLength(0);
    store.destroy();
  });
});

describe("createSparkplugTreeStore — out-of-order replay", () => {
  it("never overwrites a metric with an older arrival", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    emit("msgs", [
      ndata(BASE_MS + 5000, {
        metrics: [
          { name: "Volts/L1", floatValue: 250, timestamp: String(BASE_MS + 5000) },
        ],
      }),
    ]);
    emit("msgs", [
      ndata(BASE_MS + 1000, {
        metrics: [
          { name: "Volts/L1", floatValue: 100, timestamp: String(BASE_MS + 1000) },
        ],
      }),
    ]);
    const volts = findNode(get(store), "EnergyCo", "substation-7").metrics.find(
      (m) => m.name === "Volts/L1"
    )!;
    expect(volts.value).toBe("250");
    expect(volts.lastSeenMs).toBe(BASE_MS + 5000);
    store.destroy();
  });

  it("ignores a birth older than the one already recorded for the scope", async () => {
    const store = await makeStore();
    emit("msgs", [
      nbirth(BASE_MS + 5000, {
        metrics: [
          { name: "New", datatype: 9, floatValue: 1, timestamp: String(BASE_MS + 5000) },
        ],
      }),
    ]);
    emit("msgs", [
      nbirth(BASE_MS, {
        metrics: [
          { name: "Old", datatype: 9, floatValue: 2, timestamp: String(BASE_MS) },
        ],
      }),
    ]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.map((m) => m.name)).toEqual(["New"]);
    expect(node.birthAtMs).toBe(BASE_MS + 5000);
    store.destroy();
  });

  it("accepts an old birth for a scope that has none yet", async () => {
    const store = await makeStore();
    emit("msgs", [ndata(BASE_MS + 5000)]);
    emit("msgs", [nbirth(BASE_MS)]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.hasBirth).toBe(true);
    expect(node.birthAtMs).toBe(BASE_MS);
    store.destroy();
  });

  it("keeps newer live values when an older birth is replayed", async () => {
    // The first live batch always lands before the backfill it triggers.
    const store = await makeStore();
    emit("msgs", [
      ndata(BASE_MS + 2000, {
        metrics: [{ name: "Volts/L1", alias: "3", floatValue: 999 }],
      }),
    ]);
    emit("msgs", [nbirth(BASE_MS + 1000)]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    const volts = node.metrics.find((m) => m.name === "Volts/L1")!;
    expect(volts.value).toBe("999");
    expect(volts.lastSeenMs).toBe(BASE_MS + 2000);
    // The birth's other metrics still arrive, and its type sticks.
    expect(node.metrics.find((m) => m.name === "Amps/L1")).toBeDefined();
    expect(volts.typeName).toBe("Float");
    store.destroy();
  });

  it("does not let an older replayed death take down a revived node", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS + 10_000)]);
    emit("msgs", [ndeath(BASE_MS + 5_000)]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.status).toBe("online");
    expect(node.hasBirth).toBe(true);
    store.destroy();
  });

  it("does not let an older replayed seq gap re-flag a node a birth cleared", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS + 10_000)]);
    emit("msgs", [ndata(BASE_MS + 5_000, { seqGap: { expected: 1, got: 3 } })]);
    expect(findNode(get(store), "EnergyCo", "substation-7").seqOk).toBe(true);
    store.destroy();
  });

  it("lands on the same tree whatever order the messages arrive in", async () => {
    const messages = [
      nbirth(BASE_MS),
      dbirth(BASE_MS + 100),
      ndata(BASE_MS + 200, { metrics: [{ name: "Volts/L1", alias: "3", floatValue: 241 }] }),
      ddata(BASE_MS + 300),
      ndeath(BASE_MS + 400),
      nbirth(BASE_MS + 500),
      ndata(BASE_MS + 600, { metrics: [{ name: "Amps/L1", alias: "5", floatValue: 13 }] }),
    ];
    const settle = async (order: any[]) => {
      const store = await makeStore();
      for (const m of order) emit("msgs", [m]);
      const node = findNode(get(store), "EnergyCo", "substation-7");
      store.destroy();
      return JSON.stringify({
        status: node.status,
        hasBirth: node.hasBirth,
        metrics: node.metrics.map((m) => [m.name, m.value]),
        devices: node.devices.map((d) => [d.name, d.status, d.metrics.map((m) => m.value)]),
      });
    };
    const forward = await settle(messages);
    expect(await settle([...messages].reverse())).toBe(forward);
    expect(await settle([messages[3], messages[6], messages[0], messages[4], messages[1], messages[5], messages[2]])).toBe(forward);
  });
});

describe("createSparkplugTreeStore — node rebirth and devices", () => {
  it("retires a device's metrics when its node rebirths, until a new DBIRTH", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS), dbirth(BASE_MS + 100)]);
    emit("msgs", [nbirth(BASE_MS + 1000)]);
    let device = findNode(get(store), "EnergyCo", "substation-7").devices[0];
    expect(device.metrics).toHaveLength(0);
    expect(device.awaitingBirth).toBe(true);
    expect(device.hasBirth).toBe(false);

    emit("msgs", [dbirth(BASE_MS + 1100)]);
    device = findNode(get(store), "EnergyCo", "substation-7").devices[0];
    expect(device.metrics).toHaveLength(1);
    expect(device.awaitingBirth).toBe(false);
    expect(device.hasBirth).toBe(true);
    store.destroy();
  });

  it("ignores a replayed DBIRTH older than its node's latest NBIRTH", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS + 1000)]);
    emit("msgs", [dbirth(BASE_MS + 100)]);
    const device = findNode(get(store), "EnergyCo", "substation-7").devices[0];
    expect(device.metrics).toHaveLength(0);
    store.destroy();
  });
});

describe("createSparkplugTreeStore — bounds", () => {
  it("evicts the least recently heard node at the node cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await makeStore();
    const births = [];
    for (let i = 0; i < MAX_TRACKED_NODES; i++) births.push(nbirth(BASE_MS, { group: "G", node: `n${i}` }));
    emit("msgs", births);
    const extra = [];
    for (let i = 0; i < 50; i++) extra.push(nbirth(BASE_MS, { group: `other-${i}`, node: "x" }));
    emit("msgs", extra);
    const groups = get(store).groups;
    const total = groups.reduce((n, g) => n + g.nodes.length, 0);
    expect(total).toBe(MAX_TRACKED_NODES);
    expect(groups.map((g) => g.name)).toContain("other-49");
    const kept = groups.find((g) => g.name === "G")!.nodes.map((n) => n.name);
    expect(kept).not.toContain("n0");
    expect(kept).toContain(`n${MAX_TRACKED_NODES - 1}`);
    warn.mockRestore();
    store.destroy();
  });

  it("caps STATE hosts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await makeStore();
    const states = [];
    for (let i = 0; i < MAX_TRACKED_HOSTS + 20; i++) {
      states.push(msg(`spBv1.0/STATE/h${i}`, "ONLINE", BASE_MS, { msgType: "STATE", hostId: `h${i}` }));
    }
    emit("msgs", states);
    expect(get(store).hosts).toHaveLength(MAX_TRACKED_HOSTS);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    store.destroy();
  });
});

describe("createSparkplugTreeStore — snapshots", () => {
  it("reuses untouched groups between snapshots", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS, { group: "A" }), nbirth(BASE_MS, { group: "B" })]);
    const before = get(store);
    emit("msgs", [ndata(BASE_MS + 1000, { group: "B" })]);
    const after = get(store);
    expect(after.groups[0]).toBe(before.groups[0]);
    expect(after.groups[1]).not.toBe(before.groups[1]);
    store.destroy();
  });
});
