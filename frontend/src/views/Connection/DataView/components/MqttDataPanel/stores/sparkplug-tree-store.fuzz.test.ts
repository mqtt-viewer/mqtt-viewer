// Fuzzes the fold's order independence: random sessions folded in arrival
// order and shuffled, and replays re-delivering births and deaths already
// seen, must land on the same tree. Found by adversarial review.
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
  GetSparkplugSuspendedOrd: async () => 0,
}));
import { createSparkplugTreeStore } from "./sparkplug-tree-store";

const eventSet = { mqttConnected: "conn", mqttDisconnected: "disc", mqttReconnecting: "reconnecting", mqttMessages: "msgs", mqttClearHistory: "clear" } as any;
const emit = (name: string, data?: any) => {
  for (const cb of Array.from(mocks.handlers.get(name) ?? [])) cb({ data });
};
const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const BASE = 1_000_000_000;

// Deterministic PRNG.
const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const genSession = (r: () => number, len: number) => {
  const out: any[] = [];
  const names = ["X", "Y", "Z"];
  for (let n = 1; n <= len; n++) {
    const t = BASE + n * 1000; // 1 s apart
    const kind = Math.floor(r() * 7);
    const pick = () => names.filter(() => r() < 0.6);
    const mk = (topic: string, payload: any, sp: any) => ({
      id: String(n), topic, payload: b64(typeof payload === "string" ? payload : JSON.stringify(payload)), qos: 0, retain: false, timeMs: t,
      middlewareProperties: { sparkplug: { n, group: "G", edgeNode: "N", ...sp } },
    });
    switch (kind) {
      case 0:
        out.push(mk("spBv1.0/G/NBIRTH/N", { metrics: pick().map((x, i) => ({ name: x, alias: String(i + 1), datatype: r() < 0.5 ? 3 : 7, intValue: 4294967290 + i })) }, { msgType: "NBIRTH" }));
        break;
      case 1:
      case 2:
        out.push(mk("spBv1.0/G/NDATA/N", { metrics: pick().map((x) => (r() < 0.8 ? { name: x, intValue: Math.floor(r() * 4294967295) } : { alias: String(1 + Math.floor(r() * 3)), intValue: 7 })) }, { msgType: "NDATA", resolution: "resolved" }));
        break;
      case 3:
        if (r() < 0.4) out.push(mk("spBv1.0/G/NDEATH/N", "", { msgType: "NDEATH" }));
        else out.push(mk("spBv1.0/G/DDEATH/N/D", "", { msgType: "DDEATH", device: "D" }));
        break;
      case 4:
        out.push(mk("spBv1.0/G/DBIRTH/N/D", { metrics: pick().map((x, i) => ({ name: "d" + x, alias: String(i + 1), datatype: 3, intValue: i })) }, { msgType: "DBIRTH", device: "D" }));
        break;
      default:
        out.push(mk("spBv1.0/G/DDATA/N/D", { metrics: pick().map((x) => ({ name: "d" + x, intValue: Math.floor(r() * 100) })) }, { msgType: "DDATA", device: "D", resolution: "resolved", ...(r() < 0.2 ? { seqGap: { expected: 1, got: 5 } } : {}) }));
    }
  }
  return out;
};

const fold = async (batches: any[][]) => {
  mocks.handlers.clear();
  const store = createSparkplugTreeStore(1, eventSet);
  store.init();
  await store.activate();
  for (const b of batches) emit("msgs", b);
  const s: any = get(store);
  store.destroy();
  const strip = (x: any) => JSON.parse(JSON.stringify(x, (k, v) => (k === "lastSeenMs" || k === "nowMs" ? undefined : v)));
  return strip({ groups: s.groups, warnings: s.warnings.map((w: any) => w.text + "@" + w.timeMs) });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE + 10_000_000));
  mocks.getSparkplugHistory.mockReset().mockResolvedValue({ messages: [], suspendedOrd: 0 });
});
afterEach(() => vi.useRealTimers());

describe("fuzz: order independence of the live fold", () => {
  it("random sessions fold to the same tree in arrival order and in a shuffled order", async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 400 && failures.length < 3; seed++) {
      const r = rng(seed);
      const session = genSession(r, 6 + Math.floor(r() * 10));
      const inOrder = await fold(session.map((m) => [m]));
      const shuffled = session.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const other = await fold(shuffled.map((m) => [m]));
      if (JSON.stringify(inOrder) !== JSON.stringify(other)) {
        failures.push(
          `seed ${seed}: arrival ${session.map((m) => m.middlewareProperties.sparkplug.msgType + m.middlewareProperties.sparkplug.n).join(",")} vs shuffled ${shuffled.map((m) => m.middlewareProperties.sparkplug.n).join(",")}\n  in order: ${JSON.stringify(inOrder)}\n  shuffled: ${JSON.stringify(other)}`
        );
      }
    }
    if (failures.length) console.log(failures.join("\n\n"));
    expect(failures).toEqual([]);
  }, 120_000);

  // Spec-compliant sessions only (NBIRTH first, DBIRTH after NBIRTH, data
  // only in a birthed scope, NDEATH ends everything), with occasional QoS 0
  // loss. Fold live in arrival order with the view open; then fold what a
  // replay would re-deliver (every birth and death, already seen, in arrival
  // order). Re-delivering messages already folded must change nothing.
  it("re-folding already-seen births and deaths (a replay) changes nothing, compliant sessions", async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 1500 && failures.length < 3; seed++) {
      const r = rng(seed * 7919);
      const session: any[] = [];
      let n = 0;
      let nodeUp = false;
      let devUp = false;
      const mk = (topic: string, payload: any, sp: any) => {
        n++;
        return { id: String(n), topic, payload: b64(typeof payload === "string" ? payload : JSON.stringify(payload)), qos: 0, retain: false, timeMs: BASE + n * 1000,
          middlewareProperties: { sparkplug: { n, group: "G", edgeNode: "N", ...sp } } };
      };
      const len = 6 + Math.floor(r() * 14);
      while (session.length < len) {
        const x = r();
        let m: any = null;
        if (!nodeUp) {
          m = mk("spBv1.0/G/NBIRTH/N", { metrics: [{ name: "X", alias: "1", datatype: 3, intValue: 1 }, { name: "Y", alias: "2", datatype: 7, intValue: 2 }] }, { msgType: "NBIRTH" });
          nodeUp = true; devUp = false;
        } else if (x < 0.25) {
          m = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: r() < 0.5 ? "X" : "Y", intValue: Math.floor(r() * 4294967295) }] }, { msgType: "NDATA", resolution: "resolved" });
        } else if (x < 0.4) {
          m = devUp
            ? mk("spBv1.0/G/DDATA/N/D", { metrics: [{ name: "T", intValue: Math.floor(r() * 100) }] }, { msgType: "DDATA", device: "D", resolution: "resolved" })
            : mk("spBv1.0/G/DBIRTH/N/D", { metrics: [{ name: "T", alias: "1", datatype: 3, intValue: 0 }] }, { msgType: "DBIRTH", device: "D" });
          devUp = true;
        } else if (x < 0.5 && devUp) {
          m = mk("spBv1.0/G/DDEATH/N/D", "", { msgType: "DDEATH", device: "D" }); devUp = false;
        } else if (x < 0.6) {
          m = mk("spBv1.0/G/NDEATH/N", "", { msgType: "NDEATH" }); nodeUp = false; devUp = false;
        } else if (x < 0.7) {
          m = mk("spBv1.0/G/NBIRTH/N", { metrics: [{ name: "X", alias: "1", datatype: 3, intValue: 1 }, { name: "Y", alias: "2", datatype: 7, intValue: 2 }] }, { msgType: "NBIRTH" });
          devUp = false;
        } else {
          m = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: "X", intValue: Math.floor(r() * 4294967295) }] }, { msgType: "NDATA", resolution: "resolved" });
        }
        // QoS 0 loss: the viewer never receives it.
        if (r() < 0.1) continue;
        session.push(m);
      }
      const live = await fold(session.map((m) => [m]));
      const replay = session.filter((m) => /BIRTH|DEATH/.test(m.middlewareProperties.sparkplug.msgType));
      const withReplay = await fold([...session.map((m) => [m]), replay]);
      if (JSON.stringify(live) !== JSON.stringify(withReplay)) {
        const diff: string[] = [];
        const walk = (a: any, b: any, path: string) => {
          if (JSON.stringify(a) === JSON.stringify(b)) return;
          if (a && b && typeof a === "object" && typeof b === "object") {
            for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path + "." + k);
          } else diff.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
        };
        walk(live, withReplay, "");
        failures.push(`DIFF ${diff.join("; ")}`);
        failures.push(`seed ${seed}: ${session.map((m) => m.middlewareProperties.sparkplug.msgType + m.middlewareProperties.sparkplug.n).join(",")}\n  live:        ${JSON.stringify(live.groups[0].nodes[0].metrics.map((x: any) => x.name + "=" + x.value))} dev ${JSON.stringify(live.groups[0].nodes[0].devices.map((d: any) => d.metrics.map((x: any) => x.name + "=" + x.value)))} status ${live.groups[0].nodes[0].status}\n  +re-folded:  ${JSON.stringify(withReplay.groups[0].nodes[0].metrics.map((x: any) => x.name + "=" + x.value))} dev ${JSON.stringify(withReplay.groups[0].nodes[0].devices.map((d: any) => d.metrics.map((x: any) => x.name + "=" + x.value)))} status ${withReplay.groups[0].nodes[0].status}`);
      }
    }
    if (failures.length) console.log(failures.join("\n"));
    expect(failures).toEqual([]);
  }, 120_000);
});

