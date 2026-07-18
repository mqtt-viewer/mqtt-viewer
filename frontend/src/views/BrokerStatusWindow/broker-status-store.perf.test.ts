// Performance guard for the Broker Status store under sustained flood load.
//
// Interactive perf testing (the /perf-check flood harness) isn't automatable in
// CI, so this test proves the store honours its "Performance (hard
// requirements)" contract (docs/broker-status-spec.md) against a synthetic
// flood that exceeds the repo perf bar (2×2000 msg/s ⇒ 4000 msg/s here).
//
// It is a regression net, not a micro-benchmark: the thresholds are generous so
// the suite stays green under CI noise while still catching accidental
// O(n²)/per-message-allocation regressions and unbounded state growth.
//
// What it drives:
//   - ~5.5 minutes of 4000 msg/s = 1100 batch events × 1200 messages at the
//     real ~300 ms Wails batch cadence, with the 1 s observed-rate ticker
//     running. 1100 batches means each tile samples past the 900 sparkline cap,
//     so the in-place trim is actually exercised and asserted.
//   - Message mix: ~2% $SYS topics with numeric payloads (drive the tiles),
//     ~98% regular topics across a wide, mostly-distinct topic tree with
//     realistic base64 payloads (~100–300 decoded bytes) — ~9k distinct topics
//     exercise the per-topic engine's 512 admission cap.
//
// What it asserts:
//   - mean per-batch handler time < 5 ms, total handler time < 5.5 s
//     (proportional to the batch count).
//   - bounded state: sparkline sample arrays ≤ SPARKLINE_CAP (and at least one
//     reaches it), the per-topic loudest table stays ≤ 6 rows, and
//     latestByTopic never exceeds the count of distinct tracked ($SYS) topics —
//     i.e. the thousands of untracked regular topics do NOT accumulate entries.
//   - a separate fake-timer test fills and wraps the 900-deep per-topic ring
//     with near-empty batches, asserting the ring stays bounded.

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

// --- Mocks (mirror broker-status-store.test.ts exactly) -----------------------

const mocks = vi.hoisted(() => ({
  getSys: vi.fn(),
  getHist: vi.fn(),
  getMappings: vi.fn(),
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
  GetSysMessageHistory: mocks.getSys,
  GetMessageHistory: mocks.getHist,
  GetSysMetricMappingsByConnectionId: mocks.getMappings,
}));

import { createBrokerStatusStore, SPARKLINE_CAP } from "./broker-status-store";

// --- Helpers ------------------------------------------------------------------

const CONN = 7;
const BASE_MS = 1_000_000_000; // fixed epoch base for deterministic buckets

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
// deterministic buckets — but NOT a faked clock, or we couldn't measure real
// CPU work. By default vi.useFakeTimers() also fakes performance.now() AND
// process.hrtime (both freeze until the fake clock is advanced), which would
// report 0 ms per batch. So we fake only the timer/Date APIs the store uses and
// leave performance.now() real. See FAKE_TIMER_APIS below.
const FAKE_TIMER_APIS = [
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
  "Date",
] as const;

let nextId = 1;
const mkMsg = (topic: string, payloadB64: string) =>
  ({
    id: String(nextId++),
    topic,
    payload: payloadB64,
    qos: 0,
    retain: false,
    timeMs: 0, // set per-iteration, outside the timed section
    middlewareProperties: null,
  }) as any;

// --- Flood parameters ---------------------------------------------------------

const BATCHES = 1100; // 1100 × 300 ms ≈ 330 s; enough to exceed the 900 cap
const MSGS_PER_BATCH = 1200; // 1200 / 0.3 s = 4000 msg/s
const BATCH_MS = 300; // real Wails batch cadence
const TEMPLATES = 8; // handful of reused batch objects
const SYS_PER_BATCH = Math.round(MSGS_PER_BATCH * 0.02); // ~2% → 24

// Distinct $SYS topics emitted every batch. The first nine drive builtin tiles
// (mosquitto-style); the last three are $SYS browser rows with no tile. All of
// them — and ONLY them — are allowed to accumulate in latestByTopic.
const SYS_TOPICS: readonly string[] = [
  "$SYS/broker/clients/connected",
  "$SYS/broker/subscriptions/count",
  "$SYS/broker/retained messages/count",
  "$SYS/broker/uptime",
  "$SYS/broker/version",
  "$SYS/broker/load/messages/received/1min",
  "$SYS/broker/load/messages/sent/1min",
  "$SYS/broker/load/bytes/received/1min",
  "$SYS/broker/load/bytes/sent/1min",
  "$SYS/broker/messages/stored",
  "$SYS/broker/clients/total",
  "$SYS/broker/heap/current",
];

// Numeric/string payload for a $SYS topic, varied per template so successive
// samples differ (exercises the recompute + sparkline push path).
const sysPayload = (topic: string, ti: number): string => {
  if (topic.endsWith("/version")) return "mosquitto 2.0.18";
  if (topic.endsWith("/uptime")) return `${3600 + ti * 300} seconds`;
  if (topic.endsWith("/1min")) return String(1200 + ti * 13 + 0.5);
  return String(40 + ti * 7); // gauges: clients, subs, retained, etc.
};

// Pool of realistic base64 payloads (~100–300 decoded bytes) for regular
// topics — allocated once, referenced by templates so no per-message alloc.
const payloadPool: readonly string[] = Array.from({ length: 64 }, (_, i) => {
  const len = 100 + ((i * 29) % 201); // 100..300 bytes
  const bytes = Buffer.alloc(len);
  for (let j = 0; j < len; j++) bytes[j] = (i * 31 + j * 17) & 0xff;
  return bytes.toString("base64");
});

// Builds one reusable batch template. A running counter gives regular topics
// mostly-distinct leaves so latestByTopic bounding is a real test (thousands of
// distinct untracked topics must not accumulate).
let topicCounter = 0;
const buildTemplate = (ti: number): any[] => {
  const msgs: any[] = [];
  for (let k = 0; k < SYS_PER_BATCH; k++) {
    const topic = SYS_TOPICS[k % SYS_TOPICS.length];
    msgs.push(mkMsg(topic, b64(sysPayload(topic, ti))));
  }
  for (let k = SYS_PER_BATCH; k < MSGS_PER_BATCH; k++) {
    const topic = `factory/line${ti}/area${k & 15}/dev${topicCounter}/telemetry`;
    topicCounter++;
    msgs.push(mkMsg(topic, payloadPool[topicCounter % payloadPool.length]));
  }
  return msgs;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE_TIMER_APIS] });
  vi.setSystemTime(new Date(BASE_MS));
  mocks.handlers.clear();
  mocks.getSys.mockReset().mockResolvedValue([]);
  mocks.getHist.mockReset().mockResolvedValue([]);
  mocks.getMappings.mockReset().mockResolvedValue([]);
  nextId = 1;
  topicCounter = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBrokerStatusStore — flood perf", () => {
  it("processes 3 min of 4000 msg/s within the perf contract and stays bounded", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();

    // Pre-build the reusable batch templates OUTSIDE the timed section so the
    // measurement never includes fixture allocation.
    const templates = Array.from({ length: TEMPLATES }, (_, ti) =>
      buildTemplate(ti)
    );
    const distinctRegularLeaves = topicCounter; // for the log / sanity

    const perBatchMs: number[] = new Array(BATCHES);

    for (let i = 0; i < BATCHES; i++) {
      const now = Date.now();
      const batch = templates[i % TEMPLATES];
      // Untimed: advance each reused message's timestamp so the store treats it
      // as fresh (drives bucket rotation + per-batch sparkline sampling). Pure
      // field writes — no allocation.
      for (const m of batch) m.timeMs = now;

      const t0 = performance.now();
      emit("msgs", batch); // the batch handler: ingest + one coalesced flush
      perBatchMs[i] = performance.now() - t0;

      // Advance the fake clock one batch cadence; fires the 1 s observed-rate
      // ticker as scheduled (its cost is deliberately outside the measurement).
      vi.advanceTimersByTime(BATCH_MS);
    }

    const total = perBatchMs.reduce((a, b) => a + b, 0);
    const mean = total / BATCHES;
    const max = Math.max(...perBatchMs);

    const state = get(store);
    const distinctSysTopics = new Set(SYS_TOPICS).size;
    const maxSamples = Math.max(...state.tiles.map((t) => t.samples.length));

    console.info(
      "[broker-status perf] " +
        JSON.stringify({
          batches: BATCHES,
          msgsPerBatch: MSGS_PER_BATCH,
          totalMessages: BATCHES * MSGS_PER_BATCH,
          effectiveMsgPerSec: MSGS_PER_BATCH / (BATCH_MS / 1000),
          meanPerBatchMs: Number(mean.toFixed(4)),
          maxPerBatchMs: Number(max.toFixed(4)),
          totalHandlerMs: Number(total.toFixed(2)),
          latestByTopicSize: state.latestByTopic.size,
          distinctSysTopics,
          distinctRegularLeaves,
          maxSparklineSamples: maxSamples,
          sparklineCap: SPARKLINE_CAP,
        })
    );

    // Sanity: real elapsed time was measured (guards against a faked clock
    // silently zeroing the benchmark — see realNowMs above).
    expect(total).toBeGreaterThan(0);

    // Perf contract (generous CI headroom; the point is catching O(n²) /
    // per-message-allocation regressions, not micro-benchmarks).
    expect(mean).toBeLessThan(5);
    expect(total).toBeLessThan(5500);

    // Bounded state: no sparkline buffer exceeds the cap...
    for (const t of state.tiles) {
      expect(t.samples.length).toBeLessThanOrEqual(SPARKLINE_CAP);
    }
    // ...and at least one gauge tile actually reached the cap, proving the
    // in-place trim runs (not merely that buffers never grew).
    expect(maxSamples).toBe(SPARKLINE_CAP);

    // Per-topic engine stayed bounded under the wide flood: the loudest table
    // never exceeds its row cap, and the ring never exceeds its depth.
    expect(state.loudest.rows.length).toBeLessThanOrEqual(6);
    expect(store.topicRingSize()).toBeLessThanOrEqual(900);

    // Bounded state: latestByTopic holds only the distinct tracked ($SYS)
    // topics. The ~9k distinct untracked regular topics contributed to the rate
    // counters only — they must NOT accumulate entries.
    expect(state.latestByTopic.size).toBeLessThanOrEqual(distinctSysTopics);
    expect(distinctRegularLeaves).toBeGreaterThan(1000); // the flood really was wide

    store.destroy();
  });

  // Cheap, deterministic ring-wrap test on the fake clock: fire far more than
  // 900 ticks with tiny batches and assert the 900-deep per-topic ring (and the
  // observed series ring) stay bounded rather than growing per tick.
  it("keeps the per-topic ring bounded as it wraps past its depth", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init(); // await so the 1 s ticker is running before the loop

    const TICKS = 1200; // > 900, so the ring wraps fully
    for (let i = 0; i < TICKS; i++) {
      // One near-empty batch per second keeps the ring turning cheaply.
      const m = mkMsg(`ring/topic${i & 7}`, b64("x"));
      m.timeMs = Date.now();
      emit("msgs", [m]);
      vi.advanceTimersByTime(1000); // one ticker tick → one ring record
    }

    expect(store.topicRingSize()).toBe(900); // capped at depth, not TICKS
    expect(get(store).observedSeries.length).toBeLessThanOrEqual(900);
    store.destroy();
  });
});
