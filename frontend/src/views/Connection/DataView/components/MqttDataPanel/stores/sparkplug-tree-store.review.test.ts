// Regression tests for adversarial review findings on the Sparkplug store:
// drops, repeated samples, clears, value budgets, hidden-view replays,
// replay chunking and fold order.
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
  getSparkplugHistory: vi.fn(),
  getSuspendedOrd: vi.fn(),
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
  GetSparkplugSuspendedOrd: mocks.getSuspendedOrd,
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
const nbirth = (t: number, metrics: any[]) =>
  msg(`spBv1.0/${G}/NBIRTH/${N}`, { timestamp: String(t), metrics, seq: "0" }, t, {
    msgType: "NBIRTH",
    group: G,
    edgeNode: N,
  });
const ndata = (t: number, metrics: any[], extra: Record<string, any> = {}) =>
  msg(`spBv1.0/${G}/NDATA/${N}`, { timestamp: String(t), metrics, seq: "1" }, t, {
    msgType: "NDATA",
    group: G,
    edgeNode: N,
    resolution: "resolved",
    ...extra,
  });

const BASE = 1_000_000_000;
const snap = (store: any) => get(store) as SparkplugTreeState;
const node0 = (s: SparkplugTreeState) => s.groups[0]?.nodes[0];
const metricOf = (s: SparkplugTreeState, name: string) =>
  node0(s)?.metrics.find((m) => m.name === name);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE + 10_000_000));
  mocks.handlers.clear();
  mocks.getSparkplugHistory.mockReset().mockResolvedValue({ messages: [], suspendedOrd: 0 });
  mocks.getSuspendedOrd.mockReset().mockResolvedValue(0);
});
afterEach(() => vi.useRealTimers());

describe("review regressions", () => {
  // Claim 3. The backend buffer is drained every 300ms and StopHandlingBuffer
  // on a drop does not flush it: messages received in the last <=300ms before
  // the drop are emitted in the first batch AFTER the reconnect. The store
  // places the drop at maxOrdSeen + 0.5 (only what it has been sent), so those
  // pre-drop messages count as "heard from since the drop".
  it("a pre-drop message drained after the reconnect reads as heard-from (status should stay unknown)", async () => {
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    const birth = nbirth(Date.now() - 5000, [{ name: "X", alias: "1", datatype: 10, doubleValue: 1 }]);
    const beforeDrop = ndata(Date.now() - 1000, [{ name: "X", alias: "1", doubleValue: 2 }]);
    // Received by the backend just before the drop, still in its 300ms buffer.
    const inBuffer = ndata(Date.now() - 100, [{ name: "X", alias: "1", doubleValue: 3 }]);
    emit("msgs", [birth, beforeDrop]);
    emit("reconnecting");
    // The backend's drop fell after inBuffer, which it had received.
    mocks.getSuspendedOrd.mockResolvedValue(inBuffer.middlewareProperties.sparkplug.n);
    emit("conn");
    // First drain after reconnect: the buffered pre-drop message. The node
    // itself has published nothing since the drop.
    emit("msgs", [inBuffer]);
    await vi.waitFor(() => expect(node0(snap(store)).status).toBe("unknown"));
    store.destroy();
  });

  // Claims 1/7. Sparkplug allows several values of one metric in one payload
  // (samples with their own timestamps). Live folding keeps the FIRST (same
  // ord, `ord > existing.lastSeenOrd` fails for the rest). The backend's
  // latest-value index keeps the LAST (indexValues overwrites), so a replay
  // rebuilds a message containing only the last sample.
  it("several samples of one metric in one message: live and replay both keep the last", async () => {
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    const b = nbirth(BASE, [{ name: "X", alias: "1", datatype: 10, doubleValue: 0 }]);
    const d = ndata(BASE + 1000, [
      { name: "X", alias: "1", timestamp: String(BASE + 100), doubleValue: 1 },
      { name: "X", alias: "1", timestamp: String(BASE + 200), doubleValue: 2 },
      { name: "X", alias: "1", timestamp: String(BASE + 300), doubleValue: 3 },
    ]);
    emit("msgs", [b, d]);
    const live = metricOf(snap(store), "X")!.value;
    store.destroy();
    mocks.handlers.clear();

    // What GetSparkplugMessageHistory returns: the birth plus a rebuilt NDATA
    // (same id and n) holding the index's value for X, the last sample.
    const rebuilt = {
      ...d,
      payload: b64(JSON.stringify({ metrics: [{ name: "X", alias: "1", timestamp: String(BASE + 300), doubleValue: 3 }] })),
      middlewareProperties: { sparkplug: { ...d.middlewareProperties.sparkplug, replayed: true } },
    };
    mocks.getSparkplugHistory.mockResolvedValue({ messages: [b, rebuilt], suspendedOrd: 0 });
    const opened = createSparkplugTreeStore(1, eventSet);
    opened.init();
    await opened.activate();
    const replayed = metricOf(snap(opened), "X")!.value;
    opened.destroy();
    expect({ live, replayed }).toEqual({ live: "3", replayed: "3" });
  });

  // Claims 4/7. After a history clear the backend keeps aliases (names
  // resolve) but the frontend drops every birth, and data messages omit the
  // datatype. Signed values then render as their unsigned wire form.
  it("after clear history, an Int32 of -1 still renders as -1", async () => {
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    const birth = nbirth(BASE, [{ name: "Temp", alias: "1", datatype: 3, intValue: 0 }]);
    emit("msgs", [birth]);
    emit("msgs", [ndata(BASE + 1000, [{ name: "Temp", alias: "1", intValue: 4294967295 }])]);
    expect(metricOf(snap(store), "Temp")!.value).toBe("-1");
    // The backend keeps the birth through a clear, and the open view
    // rebuilds from it.
    mocks.getSparkplugHistory.mockResolvedValue({ messages: [birth], suspendedOrd: 0 });
    emit("clear");
    await vi.waitFor(() => expect(snap(store).replaying).toBe(false));
    // Backend still injects the name (claim 4 holds), but not the datatype.
    emit("msgs", [ndata(BASE + 2000, [{ name: "Temp", alias: "1", intValue: 4294967295 }])]);
    expect(metricOf(snap(store), "Temp")!.value).toBe("-1");
    store.destroy();
  });

  // Claim 2. No byte accounting in the frontend store: each MetricRt keeps
  // the whole PayloadMetric (`source`) plus value/valueRaw. The backend caps
  // its index at 64 MiB; the frontend holds whatever arrives.
  it("keeps values within the value budget", async () => {
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    const big = "y".repeat(1 << 20);
    const metrics = [] as any[];
    for (let i = 0; i < 100; i++) metrics.push({ name: `File${i}`, datatype: 12, stringValue: big + i });
    emit("msgs", [ndata(BASE, metrics.slice(0, 50))]);
    emit("msgs", [ndata(BASE + 1, metrics.slice(50))]);
    const held = node0(snap(store)).metrics.reduce((n, m) => n + m.valueRaw.length, 0);
    store.destroy();
    expect(held).toBeLessThanOrEqual(64 * 1024 * 1024);
  });

  // Claims 1/8. An idle backfill (fired while hidden, before any Sparkplug
  // traffic) is still in flight when a birth arrives live and the view opens.
  // setActive(true) reuses the in-flight replay, whose snapshot predates the
  // birth; the birth was only noted for liveness because the view was hidden.
  // The birth's metrics never appear.
  it("opening the view during an in-flight idle backfill fetches again, keeping a birth received while hidden", async () => {
    let resolveIdle: (v: any) => void = () => {};
    mocks.getSparkplugHistory.mockReturnValueOnce(new Promise((r) => (resolveIdle = r)));
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await vi.advanceTimersByTimeAsync(2100); // idle backfill fires, snapshot taken (empty)
    expect(mocks.getSparkplugHistory).toHaveBeenCalledTimes(1);
    const birth = nbirth(Date.now(), [{ name: "X", alias: "1", datatype: 10, doubleValue: 42 }]);
    emit("msgs", [birth]);
    // The backend's snapshot now includes the birth.
    mocks.getSparkplugHistory.mockResolvedValueOnce({ messages: [birth], suspendedOrd: 0 });
    const opened = store.setActive(true);
    expect(mocks.getSparkplugHistory).toHaveBeenCalledTimes(2);
    resolveIdle({ messages: [], suspendedOrd: 0 });
    await opened;
    await vi.advanceTimersByTimeAsync(0);
    expect(metricOf(snap(store), "X")?.value).toBe("42");
    store.destroy();
  });

  // Claim 8. "No payload decoding while hidden": STATE payloads are still
  // base64-decoded and JSON-parsed while hidden.
  it("does not decode STATE payloads while the view is hidden", async () => {
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    const parse = vi.spyOn(JSON, "parse");
    emit("msgs", [
      msg("spBv1.0/STATE/scada", { online: true, timestamp: BASE }, BASE, { msgType: "STATE", hostId: "scada" }),
    ]);
    const calls = parse.mock.calls.length;
    parse.mockRestore();
    store.destroy();
    expect(calls).toBe(0);
  });

  // Control for claim 8: connected, view open, no traffic: the ticker expires it.
  it("control: a storm badge expires ~90s after the last birth with no traffic", async () => {
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) emit("msgs", [nbirth(t0 + i * 1000, [])]);
    expect(node0(snap(store)).storm).toBe(true);
    await vi.advanceTimersByTimeAsync(3000 + 91_000);
    expect(node0(snap(store)).storm).toBe(false);
    store.destroy();
  });

  // Perf: opening the view at the backend's caps. The whole replay is folded
  // synchronously in one ingest() call on the renderer's main thread.
  it("opening the view on a capped session folds the replay in chunks", async () => {
    vi.useRealTimers();
    const NODES = 4096;
    const PER = 64; // 4096 * 64 = 262144 = MAX_METRICS_TOTAL
    const messages: any[] = [];
    let n = 1;
    const mk = (topic: string, payload: any, sp: any) => ({
      id: String(n), topic, payload: b64(JSON.stringify(payload)), qos: 0, retain: false, timeMs: BASE + n,
      middlewareProperties: { sparkplug: { n: n++, ...sp } },
    });
    for (let i = 0; i < NODES; i++) {
      const metrics = Array.from({ length: PER }, (_, m) => ({ name: `Area${m >> 3}/Tag${m}`, alias: String(m + 1), datatype: 10, doubleValue: m, properties: { keys: ["engUnit"], values: [{ type: 12, stringValue: "V" }] } }));
      messages.push(mk(`spBv1.0/G/NBIRTH/e${i}`, { seq: "0", metrics }, { msgType: "NBIRTH", group: "G", edgeNode: `e${i}` }));
    }
    for (let i = 0; i < NODES; i++) {
      const metrics = Array.from({ length: PER }, (_, m) => ({ name: `Area${m >> 3}/Tag${m}`, alias: String(m + 1), doubleValue: m + 0.5 }));
      messages.push(mk(`spBv1.0/G/NDATA/e${i}`, { seq: "1", metrics }, { msgType: "NDATA", group: "G", edgeNode: `e${i}`, resolution: "resolved", replayed: true }));
    }
    mocks.getSparkplugHistory.mockResolvedValue({ messages, suspendedOrd: 0 });
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    // A heartbeat on the same queue the fold yields to: the longest gap
    // between beats is the longest the renderer was blocked.
    let maxGap = 0;
    let last = performance.now();
    let running = true;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
      if (running) channel.port2.postMessage(null);
    };
    channel.port2.postMessage(null);
    const t0 = performance.now();
    await store.activate();
    const ms = performance.now() - t0;
    running = false;
    channel.port1.close();
    const s = snap(store);
    const total = s.groups[0].nodes.reduce((a, x) => a + x.metrics.length, 0);
    console.log(
      `replay of ${messages.length} messages / ${total} metrics: ${ms.toFixed(0)} ms in all, longest block ${maxGap.toFixed(0)} ms`
    );
    store.destroy();
    expect(total).toBe(NODES * PER);
    // Generous for a shared CI box; the fold itself runs in ~30 ms chunks.
    expect(maxGap).toBeLessThan(500);
  }, 120_000);

  // Claim 1, minimal repros found by fuzzing (sparkplug-tree-store.fuzz.test.ts).
  const ndeathMsg = (t: number) =>
    msg(`spBv1.0/${G}/NDEATH/${N}`, "", t, { msgType: "NDEATH", group: G, edgeNode: N });
  const ddataMsg = (t: number, metrics: any[]) =>
    msg(`spBv1.0/${G}/DDATA/${N}/D`, { metrics, seq: "2" }, t, { msgType: "DDATA", group: G, edgeNode: N, device: "D", resolution: "resolved" });
  const foldBatches = async (batches: any[][]) => {
    mocks.handlers.clear();
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    await store.activate();
    for (const b of batches) emit("msgs", b);
    const names = node0(snap(store)).metrics.map((m) => `${m.name}=${m.value}`);
    store.destroy();
    return names;
  };

  it("order: data from a dead session folded after the death and newer data resurrects its metric", async () => {
    const d1 = ndata(BASE + 1000, [{ name: "Old", intValue: 1 }]);
    const death = ndeathMsg(BASE + 2000);
    const d3 = ndata(BASE + 3000, [{ name: "New", intValue: 3 }]);
    const arrival = await foldBatches([[d1], [death], [d3]]);
    const other = await foldBatches([[death], [d3], [d1]]);
    expect(other).toEqual(arrival);
  });

  it("re-fold: replaying an NDEATH already seen drops the node's last values when device data followed it", async () => {
    // Node births, reports, dies; its next NBIRTH and DBIRTH are lost (QoS 0)
    // and device data arrives. The live fold keeps the node's last values.
    const b = nbirth(BASE, [{ name: "X", alias: "1", datatype: 10, doubleValue: 1 }]);
    const d = ndata(BASE + 1000, [{ name: "X", alias: "1", doubleValue: 2 }]);
    const death = ndeathMsg(BASE + 2000);
    const dd = ddataMsg(BASE + 3000, [{ name: "T", intValue: 5 }]);
    const live = await foldBatches([[b], [d], [death], [dd]]);
    // Toggling the view off and on re-runs the replay, which re-delivers the
    // birth and death already folded.
    const toggled = await foldBatches([[b], [d], [death], [dd], [b, death]]);
    expect(toggled).toEqual(live);
  });

  it("re-fold: a superseded NBIRTH replayed after an unbirthed restart re-types the new session's metrics", async () => {
    const b0 = nbirth(BASE - 1000, [{ name: "X", alias: "1", datatype: 3, intValue: 0 }]);
    const b1 = nbirth(BASE, [{ name: "X", alias: "1", datatype: 3, intValue: 0 }]);
    const death = ndeathMsg(BASE + 1000);
    // Next NBIRTH lost; data carries wire names after the restart.
    const d = ndata(BASE + 2000, [{ name: "X", intValue: 4294967295 }]);
    const live = await foldBatches([[b0], [b1], [death], [d]]);
    // The replay re-delivers recent NBIRTHs (birthRefs) and the death.
    const toggled = await foldBatches([[b0], [b1], [death], [d], [b0, b1, death]]);
    expect(toggled).toEqual(live);
  });
});

