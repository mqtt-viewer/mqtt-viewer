// Performance guard for the Sparkplug tree store under sustained flood load.
//
// Mirrors broker-status-store.perf.test.ts: a regression net (not a
// micro-benchmark) proving the store's batch handler stays cheap and its state
// bounded under a synthetic flood exceeding the repo perf bar.
//
// What it drives:
//   - 3 minutes of batches at the real ~300 ms Wails cadence (600 batches),
//     each mixing ~600 Sparkplug NDATA messages (20 nodes × 30 metrics, a few
//     changed metrics per message) with ~600 non-Sparkplug messages.
//   - A second pure non-Sparkplug flood proving the early exit is near-free.
//
// What it asserts:
//   - mean per-batch handler time < 5 ms, total handler time < 3 s.
//   - the non-Sparkplug-only flood costs well under the Sparkplug one.
//   - bounded state: node count, per-node metric count, warnings <= cap.

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

// --- Mocks (mirror sparkplug-tree-store.test.ts exactly) ----------------------

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
  WARNING_CAP,
} from "./sparkplug-tree-store";

// --- Helpers ------------------------------------------------------------------

const CONN = 7;
const BASE_MS = 1_000_000_000;

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

// The store needs faked timers (ticker interval) and a controllable Date for
// determinism — but NOT a faked performance.now(), or the benchmark would read
// 0 ms. Fake only the timer/Date APIs the store uses (see the broker-status
// perf test for the full rationale).
const FAKE_TIMER_APIS = [
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
  "Date",
] as const;

let nextId = 1;
const mkMsg = (topic: string, payloadB64: string, sparkplug: any | null) =>
  ({
    id: String(nextId++),
    topic,
    payload: payloadB64,
    qos: 0,
    retain: false,
    timeMs: 0, // set per-iteration, outside the timed section
    middlewareProperties: sparkplug ? { sparkplug } : null,
  }) as any;

// --- Flood parameters ---------------------------------------------------------

const BATCHES = 600; // 600 × 300 ms = 3 minutes
const SP_PER_BATCH = 600; // ~2000 Sparkplug msg/s
const PLAIN_PER_BATCH = 600; // ~2000 non-Sparkplug msg/s alongside
const BATCH_MS = 300;
const TEMPLATES = 8;
const NODES = 20;
const METRICS_PER_NODE = 30;
const CHANGED_PER_MSG = 5; // realistic NDATA delta size

const GROUP = "EnergyCo";
const nodeName = (n: number) => `substation-${n}`;
const metricName = (m: number) => `Metrics/Channel${m}`;

const birthMsg = (n: number): any => {
  const metrics: any[] = [
    { name: "bdSeq", datatype: 8, longValue: "0", timestamp: "0" },
  ];
  for (let m = 0; m < METRICS_PER_NODE; m++) {
    metrics.push({
      name: metricName(m),
      alias: String(m + 1),
      datatype: 10,
      doubleValue: m * 1.5,
      timestamp: "0",
    });
  }
  return mkMsg(
    `spBv1.0/${GROUP}/NBIRTH/${nodeName(n)}`,
    b64(JSON.stringify({ timestamp: "0", metrics, seq: "0" })),
    { msgType: "NBIRTH", group: GROUP, edgeNode: nodeName(n), bdSeq: 0 }
  );
};

// One reusable NDATA message: node k, CHANGED_PER_MSG named metrics.
const ndataMsg = (k: number, ti: number): any => {
  const n = k % NODES;
  const metrics: any[] = [];
  for (let c = 0; c < CHANGED_PER_MSG; c++) {
    const m = (k * CHANGED_PER_MSG + c + ti) % METRICS_PER_NODE;
    metrics.push({
      name: metricName(m),
      alias: String(m + 1),
      doubleValue: 100 + ((k * 31 + c * 17 + ti) % 1000) / 3,
      timestamp: "0",
    });
  }
  return mkMsg(
    `spBv1.0/${GROUP}/NDATA/${nodeName(n)}`,
    b64(JSON.stringify({ timestamp: "0", metrics, seq: String(k % 256) })),
    {
      msgType: "NDATA",
      group: GROUP,
      edgeNode: nodeName(n),
      resolution: "resolved",
      birthAtMs: BASE_MS,
    }
  );
};

// Pool of realistic plain payloads (~100–300 decoded bytes), allocated once.
const payloadPool: readonly string[] = Array.from({ length: 64 }, (_, i) => {
  const len = 100 + ((i * 29) % 201);
  const bytes = Buffer.alloc(len);
  for (let j = 0; j < len; j++) bytes[j] = (i * 31 + j * 17) & 0xff;
  return bytes.toString("base64");
});

let plainTopicCounter = 0;
const plainMsg = (): any => {
  const topic = `factory/area${plainTopicCounter & 15}/dev${plainTopicCounter}/telemetry`;
  plainTopicCounter++;
  return mkMsg(topic, payloadPool[plainTopicCounter % payloadPool.length], null);
};

const buildMixedTemplate = (ti: number): any[] => {
  const msgs: any[] = [];
  for (let k = 0; k < SP_PER_BATCH; k++) msgs.push(ndataMsg(k, ti));
  for (let k = 0; k < PLAIN_PER_BATCH; k++) msgs.push(plainMsg());
  return msgs;
};

const buildPlainTemplate = (): any[] => {
  const msgs: any[] = [];
  for (let k = 0; k < SP_PER_BATCH + PLAIN_PER_BATCH; k++) msgs.push(plainMsg());
  return msgs;
};

const runFlood = (templates: any[][], batches: number): number[] => {
  const perBatchMs: number[] = new Array(batches);
  for (let i = 0; i < batches; i++) {
    const now = Date.now();
    const batch = templates[i % templates.length];
    for (const m of batch) m.timeMs = now; // untimed field writes

    const t0 = performance.now();
    emit("msgs", batch);
    perBatchMs[i] = performance.now() - t0;

    vi.advanceTimersByTime(BATCH_MS);
  }
  return perBatchMs;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE_TIMER_APIS] });
  vi.setSystemTime(new Date(BASE_MS));
  mocks.handlers.clear();
  mocks.getSparkplugHistory.mockReset().mockResolvedValue([]);
  nextId = 1;
  plainTopicCounter = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSparkplugTreeStore — flood perf", () => {
  it("processes 3 min of mixed 4000 msg/s within the perf contract and stays bounded", async () => {
    const store = createSparkplugTreeStore(CONN, eventSet);
    await store.init();

    // Births first (outside the timed section) so datas resolve into an
    // established metric set — the steady-state shape.
    emit("msgs", Array.from({ length: NODES }, (_, n) => birthMsg(n)));

    const mixedTemplates = Array.from({ length: TEMPLATES }, (_, ti) =>
      buildMixedTemplate(ti)
    );

    const perBatchMs = runFlood(mixedTemplates, BATCHES);
    const total = perBatchMs.reduce((a, b) => a + b, 0);
    const mean = total / BATCHES;
    const max = Math.max(...perBatchMs);

    const state = get(store);
    const nodeCount = state.groups.reduce((a, g) => a + g.nodes.length, 0);
    const maxMetricCount = Math.max(
      ...state.groups.flatMap((g) => g.nodes.map((n) => n.metrics.length))
    );

    console.info(
      "[sparkplug-tree perf] " +
        JSON.stringify({
          batches: BATCHES,
          msgsPerBatch: SP_PER_BATCH + PLAIN_PER_BATCH,
          totalMessages: BATCHES * (SP_PER_BATCH + PLAIN_PER_BATCH),
          effectiveMsgPerSec: (SP_PER_BATCH + PLAIN_PER_BATCH) / (BATCH_MS / 1000),
          meanPerBatchMs: Number(mean.toFixed(4)),
          maxPerBatchMs: Number(max.toFixed(4)),
          totalHandlerMs: Number(total.toFixed(2)),
          nodeCount,
          maxMetricCount,
          warnings: state.warningCount,
        })
    );

    // Sanity: real elapsed time was measured.
    expect(total).toBeGreaterThan(0);

    // Perf contract (generous CI headroom).
    expect(mean).toBeLessThan(5);
    expect(total).toBeLessThan(3000);

    // Bounded state: the tree is bounded by the distinct names in the traffic,
    // not by message volume.
    expect(nodeCount).toBe(NODES);
    expect(maxMetricCount).toBeLessThanOrEqual(METRICS_PER_NODE);
    expect(state.warnings.length).toBeLessThanOrEqual(WARNING_CAP);

    store.destroy();
  });

  it("costs near nothing for a flood with no Sparkplug traffic at all", async () => {
    // Reference cost: the mixed flood over a shorter run.
    const refStore = createSparkplugTreeStore(CONN, eventSet);
    await refStore.init();
    emit("msgs", Array.from({ length: NODES }, (_, n) => birthMsg(n)));
    const mixedTemplates = Array.from({ length: TEMPLATES }, (_, ti) =>
      buildMixedTemplate(ti)
    );
    const REF_BATCHES = 100;
    const mixedTotal = runFlood(mixedTemplates, REF_BATCHES).reduce(
      (a, b) => a + b,
      0
    );
    refStore.destroy();

    // The same message volume with zero Sparkplug messages against a fresh
    // store (the no-Sparkplug-user case): the handler is a single property
    // read per message and never flushes the store.
    const store = createSparkplugTreeStore(CONN, eventSet);
    await store.init();
    let writes = 0;
    const unsub = store.subscribe(() => writes++);
    writes = 0;
    const plainTemplates = Array.from({ length: TEMPLATES }, () =>
      buildPlainTemplate()
    );
    const plainTotal = runFlood(plainTemplates, REF_BATCHES).reduce(
      (a, b) => a + b,
      0
    );
    unsub();

    console.info(
      "[sparkplug-tree perf] " +
        JSON.stringify({
          refBatches: REF_BATCHES,
          mixedTotalMs: Number(mixedTotal.toFixed(2)),
          plainOnlyTotalMs: Number(plainTotal.toFixed(2)),
        })
    );

    // No Sparkplug in the batch → no store write at all...
    expect(writes).toBe(0);
    // ...and the whole flood costs well under the Sparkplug-bearing one.
    expect(plainTotal).toBeLessThan(mixedTotal / 4);

    store.destroy();
  });
});
