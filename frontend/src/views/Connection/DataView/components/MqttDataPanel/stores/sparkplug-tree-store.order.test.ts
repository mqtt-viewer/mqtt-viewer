import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

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

import { createSparkplugTreeStore, type SparkplugTreeState } from "./sparkplug-tree-store";

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
// Messages are created in the order the backend received them, so the
// creation counter doubles as the backend's arrival order ("n").
const msg = (topic: string, payload: any, timeMs: number, sparkplug: Record<string, any>) => {
  const n = nextId++;
  return {
    id: String(n),
    topic,
    payload: b64(typeof payload === "string" ? payload : JSON.stringify(payload)),
    qos: 0,
    retain: false,
    timeMs,
    middlewareProperties: { sparkplug: { n, ...sparkplug } },
  } as any;
};

const G = "G";
const N = "n1";
const nbirth = (t: number, metrics: any[], extra: Record<string, any> = {}) =>
  msg(`spBv1.0/${G}/NBIRTH/${N}`, { timestamp: String(t), metrics, seq: "0" }, t, {
    msgType: "NBIRTH",
    group: G,
    edgeNode: N,
    ...extra,
  });
const ndata = (t: number, metrics: any[], extra: Record<string, any> = {}, node = N) =>
  msg(`spBv1.0/${G}/NDATA/${node}`, { timestamp: String(t), metrics, seq: "1" }, t, {
    msgType: "NDATA",
    group: G,
    edgeNode: node,
    resolution: "resolved",
    ...extra,
  });
const ndeath = (t: number) =>
  msg(`spBv1.0/${G}/NDEATH/${N}`, "", t, { msgType: "NDEATH", group: G, edgeNode: N });
const dbirth = (t: number, metrics: any[]) =>
  msg(`spBv1.0/${G}/DBIRTH/${N}/d1`, { timestamp: String(t), metrics, seq: "1" }, t, {
    msgType: "DBIRTH",
    group: G,
    edgeNode: N,
    device: "d1",
  });

const BASE = 1_000_000_000;

// Feeds batches in order to a fresh store and returns the snapshot minus the
// clock.
const run = async (batches: any[][]): Promise<any> => {
  const store = createSparkplugTreeStore(1, eventSet);
  store.init();
  await store.activate();
  for (const b of batches) emit("msgs", b);
  const s = get(store) as SparkplugTreeState;
  store.destroy();
  mocks.handlers.clear();
  return JSON.parse(JSON.stringify({ ...s, nowMs: 0 }));
};

const metricOf = (s: any, name: string) =>
  s.groups[0].nodes[0].metrics.find((m: any) => m.name === name);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE + 10_000_000));
  mocks.handlers.clear();
  mocks.getSparkplugHistory.mockReset().mockResolvedValue({ messages: [], suspendedOrd: 0 });
});
afterEach(() => vi.useRealTimers());

describe("order independence (adversarial review repros)", () => {
  it("birth and data in the same millisecond land the same either way", async () => {
    const b = nbirth(BASE, [{ name: "X", alias: "1", datatype: 3, intValue: 1 }]);
    const d = ndata(BASE, [{ name: "X", alias: "1", intValue: 2 }]);
    const live = await run([[b], [d]]);
    const other = await run([[d], [b]]);
    expect(metricOf(live, "X").value).toBe("2");
    expect(metricOf(other, "X").value).toBe(metricOf(live, "X").value);
  });

  it("a replayed duplicate of an earlier same-millisecond data changes nothing", async () => {
    const d1 = ndata(BASE, [{ name: "X", datatype: 3, intValue: 1 }]);
    const d2 = ndata(BASE, [{ name: "X", datatype: 3, intValue: 2 }]);
    const live = await run([[d1, d2]]);
    const replayAfter = await run([[d1, d2], [d1]]);
    expect(metricOf(replayAfter, "X").value).toBe(metricOf(live, "X").value);
  });

  it("the newest birth declares the datatype and unit, whatever order births arrive in", async () => {
    const unit = (u: string) => ({ keys: ["engUnit"], values: [{ type: 12, stringValue: u }] });
    const b1 = nbirth(BASE, [{ name: "X", alias: "1", datatype: 3, intValue: 0, properties: unit("C") }]);
    const b2 = nbirth(BASE + 100, [
      { name: "X", alias: "1", datatype: 7, intValue: 0, properties: unit("F") },
    ]);
    // Data omits datatype and unit (normal for NDATA).
    const d = ndata(BASE + 200, [{ name: "X", alias: "1", intValue: 4294967291 }]);
    const watched = await run([[b1], [b2], [d]]);
    // View opened mid-session: first live NDATA, then the replay (ascending,
    // includes both NBIRTHs via birthRefs, and the same NDATA again).
    const replayed = await run([[d], [b1, b2, d]]);
    expect(metricOf(watched, "X").typeName).toBe("UInt32");
    expect(metricOf(watched, "X").unit).toBe("F");
    expect(metricOf(replayed, "X").typeName).toBe(metricOf(watched, "X").typeName);
    expect(metricOf(replayed, "X").value).toBe(metricOf(watched, "X").value);
    expect(metricOf(replayed, "X").unit).toBe(metricOf(watched, "X").unit);
  });

  it("counts the same seq-gap warnings whatever the processing order", async () => {
    const gap = { expected: 1, got: 5 };
    const g1 = ndata(BASE, [], { seqGap: gap });
    const g2 = ndata(BASE + 3000, [], { seqGap: gap });
    const g3 = ndata(BASE + 6000, [], { seqGap: gap });
    const a = await run([[g1, g2, g3]]);
    const b = await run([[g1, g3, g2]]);
    expect(b.warningCount).toBe(a.warningCount);
  });

  it("retires the dead session's metrics whether its death or the new data comes first", async () => {
    const b = nbirth(BASE, [{ name: "Old", alias: "1", datatype: 3, intValue: 1 }]);
    const d150 = ndata(BASE + 150, [{ name: "Old", alias: "1", intValue: 2 }]);
    const death = ndeath(BASE + 200);
    const d300 = ndata(BASE + 300, [{ alias: "7", intValue: 9 }], { resolution: "unresolved" });
    const inOrder = await run([[b, d150, death, d300]]);
    const shuffled = await run([[d300], [b, d150, death]]);
    const names = (s: any) => s.groups[0].nodes[0].metrics.map((m: any) => m.name).sort();
    expect(names(shuffled)).toEqual(names(inOrder));
  });

  it("a DBIRTH older than its NBIRTH gives the same device either way", async () => {
    const db = dbirth(BASE + 100, [{ name: "D", alias: "1", datatype: 3, intValue: 1 }]);
    const nb = nbirth(BASE + 200, [{ name: "A", alias: "1", datatype: 3, intValue: 1 }]);
    const a = await run([[nb], [db]]);
    const b = await run([[db], [nb]]);
    expect(b.groups[0].nodes[0].devices[0]).toEqual(a.groups[0].nodes[0].devices[0]);
  });
});

describe("incremental snapshot (adversarial review repros)", () => {
  it("clears a cached node's storm flag when its warning is evicted", async () => {
    vi.setSystemTime(new Date(BASE + 3000));
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    const births = [0, 1000, 2000, 3000].map((dt) =>
      nbirth(BASE + dt, [{ name: "A", alias: "1", datatype: 3, intValue: 1 }])
    );
    emit("msgs", births);
    let s = get(store) as SparkplugTreeState;
    const n1 = () => (get(store) as SparkplugTreeState).groups[0].nodes.find((n) => n.name === N)!;
    expect(n1().storm).toBe(true);
    // 50 distinct seq-gap warnings on another node push the storm warning out.
    const gaps = Array.from({ length: 50 }, (_, i) =>
      // Inside the storm window, so only the eviction can clear the flag.
      ndata(BASE + 3100 + i, [], { seqGap: { expected: i, got: i + 100 } }, "n2")
    );
    emit("msgs", gaps);
    s = get(store) as SparkplugTreeState;
    expect(s.warnings.some((w) => w.kind === "rebirth-storm")).toBe(false);
    expect(n1().storm).toBe(false);
    store.destroy();
  });
});

describe("a drop the store never saw (adversarial review repros)", () => {
  it("treats births from before the backend's last drop as unverified and unknown", async () => {
    // Backend: NBIRTH at BASE, connection dropped at BASE+1000, reconnected at
    // BASE+2000, node silent since. Tab reopened at BASE+3000.
    vi.setSystemTime(new Date(BASE + 3000));
    const b = nbirth(BASE, [{ name: "A", alias: "1", datatype: 3, intValue: 1 }]);
    mocks.getSparkplugHistory.mockResolvedValue({
      messages: [b],
      suspendedOrd: b.middlewareProperties.sparkplug.n,
    });
    const store = createSparkplugTreeStore(1, eventSet, { connected: true });
    store.init();
    await store.activate();
    const node = (get(store) as SparkplugTreeState).groups[0].nodes[0];
    // Claim 9: names from pre-drop births are unverified; status only counts
    // signals since the drop.
    expect(node.verified).toBe(false);
    expect(node.status).toBe("unknown");
    store.destroy();
  });
});

describe("misc (adversarial review repros)", () => {
  it("an NBIRTH without a bdSeq clears the previous session's", async () => {
    const b1 = nbirth(BASE, [{ name: "bdSeq", datatype: 8, longValue: "3" }], { bdSeq: 3 });
    const b2 = nbirth(BASE + 1000, [{ name: "A", alias: "1", datatype: 3, intValue: 1 }]);
    const s = await run([[b1], [b2]]);
    expect(s.groups[0].nodes[0].bdSeq).toBeUndefined();
  });

  it("caps metrics across the connection like the backend does", async () => {
    const metrics = Array.from({ length: 4096 }, (_, i) => ({ name: `m${i}`, datatype: 3, intValue: i }));
    const batches: any[][] = [];
    for (let d = 0; d < 70; d++) {
      batches.push([
        msg(`spBv1.0/${G}/DDATA/${N}/dev${d}`, { metrics }, BASE + d, {
          msgType: "DDATA", group: G, edgeNode: N, device: `dev${d}`, resolution: "names",
        }),
      ]);
    }
    const s = await run(batches);
    const total = s.groups[0].nodes[0].devices.reduce((n: number, d: any) => n + d.metrics.length, 0);
    expect(total).toBeLessThanOrEqual(1 << 18);
  }, 120_000);
});

describe("seq gaps on births and deaths (adversarial review repros)", () => {
  it("a seq gap reported on a DBIRTH reaches the node", async () => {
    const nb = nbirth(BASE, [{ name: "A", alias: "1", datatype: 3, intValue: 1 }]);
    const db = msg(`spBv1.0/${G}/DBIRTH/${N}/d2`, { metrics: [] }, BASE + 10, {
      msgType: "DBIRTH", group: G, edgeNode: N, device: "d2", seqGap: { expected: 2, got: 3 },
    });
    const s = await run([[nb, db]]);
    expect(s.groups[0].nodes[0].seqOk).toBe(false);
    expect(s.warningCount).toBe(1);
  });
});

describe("warnings and badges that end", () => {
  it("clears a metric's quality when a value arrives without one", async () => {
    const q = (code: number) => ({ keys: ["Quality"], values: [{ type: 3, intValue: code }] });
    const s = await run([
      [ndata(BASE, [{ name: "P", datatype: 10, doubleValue: 1, properties: q(0) }])],
      [ndata(BASE + 100, [{ name: "P", doubleValue: 2 }])],
    ]);
    expect(metricOf(s, "P").quality).toBeUndefined();
  });

  it("expires the storm badge once births stop", async () => {
    vi.setSystemTime(new Date(BASE + 3000));
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    emit("msgs", [0, 1000, 2000, 3000].map((dt) => nbirth(BASE + dt, [])));
    const node = () =>
      (get(store) as SparkplugTreeState).groups[0].nodes.find((n) => n.name === N)!;
    expect(node().storm).toBe(true);
    // Quiet for longer than the storm window, with other traffic flowing.
    emit("msgs", [ndata(BASE + 3000 + 91_000, [], {}, "other")]);
    expect(node().storm).toBe(false);
    // The warning itself stays in the list.
    expect((get(store) as SparkplugTreeState).warnings.some((w) => w.kind === "rebirth-storm")).toBe(true);
    store.destroy();
  });

  it("expires the storm badge on the clock when nothing else arrives", async () => {
    vi.setSystemTime(new Date(BASE + 3000));
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    emit("msgs", [0, 1000, 2000, 3000].map((dt) => nbirth(BASE + dt, [])));
    const node = () => (get(store) as SparkplugTreeState).groups[0].nodes[0];
    expect(node().storm).toBe(true);
    vi.advanceTimersByTime(91_000);
    expect(node().storm).toBe(false);
    store.destroy();
  });

  it("clears warnings on request", async () => {
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    emit("msgs", [ndata(BASE, [], { seqGap: { expected: 1, got: 3 } })]);
    expect((get(store) as SparkplugTreeState).warningCount).toBe(1);
    store.clearWarnings();
    expect((get(store) as SparkplugTreeState).warningCount).toBe(0);
    store.destroy();
  });

  it("remembers the message each value came from", async () => {
    const d = ndata(BASE, [{ name: "X", datatype: 10, doubleValue: 1 }]);
    const s = await run([[d]]);
    expect(metricOf(s, "X").messageId).toBe(d.id);
    expect(metricOf(s, "X").topic).toBe(d.topic);
  });
});
