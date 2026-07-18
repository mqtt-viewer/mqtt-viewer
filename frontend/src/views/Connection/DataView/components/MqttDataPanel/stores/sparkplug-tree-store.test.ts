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
}));

import {
  createSparkplugTreeStore,
  STALE_AFTER_MS,
  WARNING_CAP,
  TICKER_MS,
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

let nextId = 1;
const msg = (
  topic: string,
  payload: string,
  timeMs: number,
  sparkplug?: Record<string, any>
) =>
  ({
    id: String(nextId++),
    topic,
    payload: b64(payload),
    qos: 0,
    retain: false,
    timeMs,
    middlewareProperties: sparkplug ? { sparkplug } : null,
  }) as any;

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

const makeStore = async () => {
  const store = createSparkplugTreeStore(CONN, eventSet);
  await store.init();
  return store;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE_MS));
  mocks.handlers.clear();
  mocks.getSparkplugHistory.mockReset().mockResolvedValue([]);
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

  it("formats numbers to at most 6 significant digits, keeping the raw value", async () => {
    const store = await makeStore();
    emit("msgs", [
      ndata(BASE_MS, {
        metrics: [
          { name: "Pi", doubleValue: 3.14159265358979, timestamp: String(BASE_MS) },
          { name: "Big", longValue: "9007199254740993", timestamp: String(BASE_MS) },
          { name: "Null", isNull: true, timestamp: String(BASE_MS) },
        ],
      }),
    ]);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    const pi = node.metrics.find((m) => m.name === "Pi")!;
    expect(pi.value).toBe("3.14159");
    expect(pi.valueRaw).toBe("3.14159265358979");
    const big = node.metrics.find((m) => m.name === "Big")!;
    expect(big.value).toBe("9007199254740993");
    expect(big.valueRaw).toBe("9007199254740993");
    const nul = node.metrics.find((m) => m.name === "Null")!;
    expect(nul.value).toBe("null");
    expect(nul.isNull).toBe(true);
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
    expect(node.rebirthCount90s).toBeGreaterThanOrEqual(4);
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

describe("createSparkplugTreeStore — staleness", () => {
  it("flags an online node's quiet metric stale after the threshold", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    vi.advanceTimersByTime(STALE_AFTER_MS + 2000); // ticker recomputes
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.every((m) => m.stale)).toBe(true);
    store.destroy();
  });

  it("does not mark offline nodes' metrics stale", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS), ndeath(BASE_MS + 100)]);
    vi.advanceTimersByTime(STALE_AFTER_MS + 2000);
    const node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.some((m) => m.stale)).toBe(false);
    store.destroy();
  });

  it("freezes staleness while disconnected and resumes on reconnect", async () => {
    const store = await makeStore();
    emit("msgs", [nbirth(BASE_MS)]);
    emit("disc");
    vi.advanceTimersByTime(STALE_AFTER_MS * 3);
    // Frozen at the disconnect time: nothing went stale while down.
    let node = findNode(store.snapshot(), "EnergyCo", "substation-7");
    expect(node.metrics.some((m) => m.stale)).toBe(false);
    emit("conn");
    vi.advanceTimersByTime(2000);
    node = findNode(get(store), "EnergyCo", "substation-7");
    expect(node.metrics.every((m) => m.stale)).toBe(true); // real time elapsed
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

  it("replays Sparkplug history on init", async () => {
    mocks.getSparkplugHistory.mockResolvedValue([
      nbirth(BASE_MS - 10_000, { bdSeq: 1 }),
      ndata(BASE_MS - 5000),
      msg(
        "spBv1.0/STATE/scada-primary",
        JSON.stringify({ online: true, timestamp: BASE_MS - 20_000 }),
        BASE_MS - 20_000,
        { msgType: "STATE", hostId: "scada-primary" }
      ),
    ]);
    const store = await makeStore();
    const state = get(store);
    expect(state.hasSparkplug).toBe(true);
    expect(state.hosts).toHaveLength(1);
    const node = findNode(state, "EnergyCo", "substation-7");
    expect(node.metrics.find((m) => m.name === "Volts/L1")!.value).toBe("240.1");
    expect(mocks.getSparkplugHistory).toHaveBeenCalledWith(CONN);
    store.destroy();
  });

  it("keeps init alive when the backfill rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getSparkplugHistory.mockRejectedValue(new Error("backend boom"));
    const store = createSparkplugTreeStore(CONN, eventSet);
    await expect(store.init()).resolves.toBeUndefined();
    store.destroy();
    errSpy.mockRestore();
  });

  it("resets everything on the clear-history event", async () => {
    const store = await makeStore();
    emit("msgs", [
      nbirth(BASE_MS),
      ndata(BASE_MS + 100, { seqGap: { expected: 1, got: 3 } }),
    ]);
    expect(get(store).hasSparkplug).toBe(true);

    emit("clear");
    const state = get(store);
    expect(state.hasSparkplug).toBe(false);
    expect(state.groups).toHaveLength(0);
    expect(state.hosts).toHaveLength(0);
    expect(state.warnings).toHaveLength(0);
    expect(state.warningCount).toBe(0);
    store.destroy();
  });

  it("discards a backfill whose clear-history landed mid-fetch", async () => {
    let resolveHist!: (v: any) => void;
    let signalCalled!: () => void;
    const called = new Promise<void>((r) => (signalCalled = r));
    mocks.getSparkplugHistory.mockImplementation(() => {
      signalCalled();
      return new Promise((res) => (resolveHist = res));
    });

    const store = createSparkplugTreeStore(CONN, eventSet);
    const initPromise = store.init();
    await called; // fetch in flight; epoch captured

    emit("clear");
    resolveHist([nbirth(BASE_MS)]);
    await initPromise;

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
    const initPromise = store.init();
    await called; // fetch in flight

    store.destroy(); // torn down before the backfill resolves
    resolveHist([nbirth(BASE_MS)]);
    await initPromise;

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
    const initPromise = store.init();
    await called; // fetch in flight; epoch captured

    // Same message object arrives live AND will be in the resolved history.
    const shared = nbirth(BASE_MS, { node: "dup-node" });
    // Genuinely new: only ever seen live, never in history.
    const liveOnly = nbirth(BASE_MS + 10, { node: "live-only-node" });
    emit("msgs", [shared, liveOnly]);

    resolveHist([shared]);
    await initPromise;

    const state = get(store);
    const dupNode = findNode(state, "EnergyCo", "dup-node");
    // If `shared` had been ingested twice, birthRing would hold 2 entries
    // and rebirthCount90s would read 2 instead of 1.
    expect(dupNode.rebirthCount90s).toBe(1);

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
    for (const name of ["msgs", "clear", "conn", "disc"]) {
      expect(mocks.handlers.get(name)?.size ?? 0).toBe(0);
    }
    const snapshot = get(store);
    emit("msgs", [nbirth(BASE_MS + 1000)]);
    expect(get(store)).toBe(snapshot);
  });
});
