// Regression tests from the final adversarial review: eviction recency, clears,
// re-delivered retained births, replays after restarts, byte limits, long
// death histories, and fuzzing with richer sessions.
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
import { createSparkplugTreeStore, MAX_TRACKED_NODES } from "./sparkplug-tree-store";

const eventSet = { mqttConnected: "conn", mqttDisconnected: "disc", mqttReconnecting: "reconnecting", mqttMessages: "msgs", mqttClearHistory: "clear" } as any;
const emit = (name: string, data?: any) => {
  for (const cb of Array.from(mocks.handlers.get(name) ?? [])) cb({ data });
};
const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const BASE = 1_000_000_000;
let n = 0;
const mk = (topic: string, payload: any, sp: any, extra: any = {}) => {
  n++;
  return {
    id: String(n), topic, payload: b64(typeof payload === "string" ? payload : JSON.stringify(payload)), qos: 0, retain: !!sp.retained, timeMs: BASE + n * 1000,
    middlewareProperties: { sparkplug: { n, ...sp } }, ...extra,
  } as any;
};

beforeEach(() => {
  n = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE + 10_000_000));
  mocks.handlers.clear();
  mocks.getSparkplugHistory.mockReset().mockResolvedValue({ messages: [], suspendedOrd: 0 });
  mocks.getSuspendedOrd.mockReset().mockResolvedValue(0);
});
afterEach(() => vi.useRealTimers());

const open = async () => {
  mocks.handlers.clear();
  const store = createSparkplugTreeStore(1, eventSet);
  store.init();
  await store.activate();
  return store;
};
const strip = (s: any) =>
  JSON.parse(JSON.stringify({ groups: s.groups, warnings: s.warnings.map((w: any) => w.text + "@" + w.timeMs) }, (k, v) => (k === "lastSeenMs" || k === "nowMs" ? undefined : v)));
const fold = async (batches: any[][]) => {
  const store = await open();
  for (const b of batches) emit("msgs", b);
  const s = strip(get(store));
  store.destroy();
  return s;
};

describe("final review regressions", () => {
  it("F1 node eviction: frontend evicts a different node than the backend when a DDEATH is a node's newest message", async () => {
    const store = await open();
    const nd = (node: string) => mk(`spBv1.0/G/NDATA/${node}`, { metrics: [{ name: "X", intValue: 1 }] }, { msgType: "NDATA", group: "G", edgeNode: node, resolution: "names" });
    emit("msgs", [nd("A")]); // ord 1
    emit("msgs", [nd("B")]); // ord 2
    emit("msgs", [mk("spBv1.0/G/DDEATH/A/D", "", { msgType: "DDEATH", group: "G", edgeNode: "A", device: "D" })]); // ord 3
    const fill = [];
    for (let i = 0; i < MAX_TRACKED_NODES - 2; i++) fill.push(nd(`F${i}`));
    emit("msgs", fill);
    emit("msgs", [nd("NEW")]);
    const names = get(store).groups[0].nodes.map((x) => x.name);
    store.destroy();
    // Backend (TestAdvEvictionChoiceWithDDeathLast) keeps A and evicts B.
    expect({ A: names.includes("A"), B: names.includes("B") }).toEqual({ A: true, B: false });
  }, 60_000);

  it("F2 clear history: the kept birth comes back without its cleared warning", async () => {
    const store = await open();
    const birth = mk("spBv1.0/G/NBIRTH/N", { seq: "5", metrics: [{ name: "A", alias: "1", datatype: 10, doubleValue: 1 }] }, { msgType: "NBIRTH", group: "G", edgeNode: "N", seqGap: { expected: 0, got: 5 } });
    emit("msgs", [birth]);
    expect(get(store).warnings.length).toBe(1);
    // What the backend returns after ClearHistory: the kept birth, its
    // seq gap stripped (TestClearHistoryStripsSeqGapsFromKeptBirths).
    const { seqGap: _gap, ...keptMeta } = birth.middlewareProperties.sparkplug;
    const kept = { ...birth, middlewareProperties: { sparkplug: keptMeta } };
    mocks.getSparkplugHistory.mockResolvedValue({ messages: [kept], suspendedOrd: 0 });
    emit("clear");
    await vi.waitFor(() => expect(get(store).replaying).toBe(false));
    const w = get(store).warnings.length;
    store.destroy();
    expect(w).toBe(0);
  });

  it("F3 a retained NBIRTH re-delivered while live leaves the node's devices alone", async () => {
    const store = await open();
    // The backend marks an identical re-delivery staleBirth
    // (TestRetainedBirthRedeliveryIsIgnored).
    const nb = (retained: boolean) => mk("spBv1.0/G/NBIRTH/N", { metrics: [{ name: "A", alias: "1", datatype: 10, doubleValue: 1 }] }, { msgType: "NBIRTH", group: "G", edgeNode: "N", ...(retained ? { retained: true, staleBirth: true } : {}) });
    emit("msgs", [nb(false)]);
    emit("msgs", [mk("spBv1.0/G/DBIRTH/N/D", { metrics: [{ name: "Temp", alias: "7", datatype: 10, doubleValue: 20 }] }, { msgType: "DBIRTH", group: "G", edgeNode: "N", device: "D" })]);
    emit("msgs", [mk("spBv1.0/G/DDATA/N/D", { metrics: [{ name: "Temp", alias: "7", doubleValue: 21 }] }, { msgType: "DDATA", group: "G", edgeNode: "N", device: "D", resolution: "resolved" })]);
    const before = get(store).groups[0].nodes[0].devices[0];
    emit("msgs", [nb(true)]); // same retained birth, re-sent on a new subscription
    const after = get(store).groups[0].nodes[0].devices[0];
    store.destroy();
    expect({ before: before.metrics.length, after: after.metrics.length, awaiting: after.awaitingBirth }).toEqual({ before: 1, after: 1, awaiting: false });
  });

  it("F4 view opened later (replay) vs watching live: birthless publisher that restarted and is now dead", async () => {
    // Live: data(X,Y), death, data(X), death.
    const d1 = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: "X", intValue: 1 }, { name: "Y", intValue: 1 }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "names" });
    const death1 = mk("spBv1.0/G/NDEATH/N", "", { msgType: "NDEATH", group: "G", edgeNode: "N" });
    const d2 = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: "X", intValue: 2 }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "names" });
    const death2 = mk("spBv1.0/G/NDEATH/N", "", { msgType: "NDEATH", group: "G", edgeNode: "N" });
    const live = await fold([[d1], [death1], [d2], [death2]]);
    // Backend replay: the restart retired Y from its index
    // (TestUnbirthedRestartRetiresOldValues), so X@d2 and the latest death.
    const r2 = { ...d2, middlewareProperties: { sparkplug: { ...d2.middlewareProperties.sparkplug, replayed: true } } };
    mocks.getSparkplugHistory.mockResolvedValue({ messages: [r2, death2], suspendedOrd: 0 });
    const replayed = await fold([]);
    const names = (s: any) => s.groups[0].nodes[0].metrics.map((m: any) => m.name);
    expect({ replay: names(replayed) }).toEqual({ replay: names(live) });
  });

  it("F5 multibyte string: live keeps it, the replay of the same session says Not kept", async () => {
    const v = "€".repeat(100_000);
    const d = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: "Label", datatype: 12, stringValue: v }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "names" });
    const live = await fold([[d]]);
    // Backend omitted it (TestAdvMultibyteStringOmittedByBytes: 300011 bytes).
    const rd = { ...d, payload: b64(JSON.stringify({ metrics: [{ name: "Label", datatype: 12 }] })), middlewareProperties: { sparkplug: { ...d.middlewareProperties.sparkplug, replayed: true, omitted: { Label: 300011 } } } };
    mocks.getSparkplugHistory.mockResolvedValue({ messages: [rd], suspendedOrd: 0 });
    const replayed = await fold([]);
    const val = (s: any) => s.groups[0].nodes[0].metrics[0].value.slice(0, 40);
    expect(val(replayed)).toBe(val(live));
  });

  it("F6 order independence with more than 16 deaths", async () => {
    const birth = mk("spBv1.0/G/NBIRTH/N", { metrics: [{ name: "X", alias: "1", datatype: 3, intValue: 1 }] }, { msgType: "NBIRTH", group: "G", edgeNode: "N" });
    const d = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: "X", intValue: 2 }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "resolved" });
    const death = () => mk("spBv1.0/G/NDEATH/N", "", { msgType: "NDEATH", group: "G", edgeNode: "N" });
    const dth = death();
    const unbirthed = mk("spBv1.0/G/NDATA/N", { metrics: [{ alias: "1", intValue: 3 }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "unresolved" });
    const more = Array.from({ length: 17 }, death);
    const arrival = [birth, d, dth, unbirthed, ...more];
    const inOrder = await fold(arrival.map((m) => [m]));
    const other = await fold([...more, dth, birth, d, unbirthed].map((m) => [m]));
    const names = (s: any) => s.groups[0].nodes[0].metrics.map((m: any) => m.name);
    expect(names(other)).toEqual(names(inOrder));
  });

  it("F7 fuzz: richer sessions (2 devices, retained, repeated samples, omitted, carriedOver, stale deaths)", async () => {
    const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
    const failures: string[] = [];
    for (let seed = 1; seed <= 600 && failures.length < 3; seed++) {
      const r = rng(seed);
      n = 0;
      const out: any[] = [];
      const len = 6 + Math.floor(r() * 16);
      for (let i = 0; i < len; i++) {
        const dev = r() < 0.5 ? "D1" : "D2";
        const ret = r() < 0.15 ? { retained: true } : {};
        const k = Math.floor(r() * 9);
        const vals = () => ["X", "Y"].filter(() => r() < 0.7).flatMap((x) => (r() < 0.3 ? [{ name: x, intValue: Math.floor(r() * 9) }, { name: x, intValue: Math.floor(r() * 9) }] : [{ name: x, intValue: Math.floor(r() * 9) }]));
        switch (k) {
          case 0:
            out.push(mk("spBv1.0/G/NBIRTH/N", { metrics: ["X", "Y"].filter(() => r() < 0.7).map((x, j) => ({ name: x, alias: String(j + 1), datatype: r() < 0.5 ? 3 : 7, intValue: 4294967290 + j, ...(r() < 0.3 ? { properties: { keys: ["engUnit"], values: [{ type: 12, stringValue: "V" + j }] } } : {}) })) }, { msgType: "NBIRTH", group: "G", edgeNode: "N", ...ret }));
            break;
          case 1:
            out.push(mk(`spBv1.0/G/DBIRTH/N/${dev}`, { metrics: ["X", "Y"].filter(() => r() < 0.7).map((x, j) => ({ name: x, alias: String(j + 1), datatype: 3, intValue: j })) }, { msgType: "DBIRTH", group: "G", edgeNode: "N", device: dev, ...ret }));
            break;
          case 2:
          case 3: {
            const om = r() < 0.15 ? { omitted: { X: 300000 } } : {};
            out.push(mk("spBv1.0/G/NDATA/N", { metrics: vals() }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "resolved", ...ret, ...om, ...(r() < 0.2 ? { carriedOver: true } : {}) }));
            break;
          }
          case 4:
          case 5:
            out.push(mk(`spBv1.0/G/DDATA/N/${dev}`, { metrics: vals() }, { msgType: "DDATA", group: "G", edgeNode: "N", device: dev, resolution: "resolved", ...ret, ...(r() < 0.2 ? { seqGap: { expected: 1, got: 3 } } : {}) }));
            break;
          case 6:
            out.push(mk("spBv1.0/G/NDEATH/N", "", { msgType: "NDEATH", group: "G", edgeNode: "N", ...ret, ...(r() < 0.2 ? { staleDeath: true } : {}) }));
            break;
          case 7:
            out.push(mk(`spBv1.0/G/DDEATH/N/${dev}`, "", { msgType: "DDEATH", group: "G", edgeNode: "N", device: dev }));
            break;
          default:
            out.push(mk("spBv1.0/G/NDATA/N", { metrics: [{ alias: String(1 + Math.floor(r() * 2)), intValue: 5 }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "unresolved" }));
        }
      }
      const a = await fold(out.map((m) => [m]));
      const sh = out.slice();
      for (let i = sh.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [sh[i], sh[j]] = [sh[j], sh[i]];
      }
      const b = await fold(sh.map((m) => [m]));
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        failures.push(`seed ${seed}: ${out.map((m) => m.middlewareProperties.sparkplug.msgType + (m.middlewareProperties.sparkplug.device ?? "") + (m.middlewareProperties.sparkplug.retained ? "r" : "") + m.middlewareProperties.sparkplug.n).join(",")}\n shuffled ${sh.map((m) => m.middlewareProperties.sparkplug.n).join(",")}\n A ${JSON.stringify(a.groups)}\n B ${JSON.stringify(b.groups)}`);
      }
    }
    if (failures.length) console.log(failures.join("\n\n"));
    expect(failures).toEqual([]);
  }, 120_000);
  it("F8 a live batch landing during the view's replay keeps a unit the newest birth dropped", async () => {
    // NBIRTH#1 declares X in V; the node rebirths (#2) without a unit; NDATA#3.
    const b1 = mk("spBv1.0/G/NBIRTH/N", { metrics: [{ name: "X", alias: "1", datatype: 10, doubleValue: 1, properties: { keys: ["engUnit"], values: [{ type: 12, stringValue: "V" }] } }] }, { msgType: "NBIRTH", group: "G", edgeNode: "N" });
    const b2 = mk("spBv1.0/G/NBIRTH/N", { metrics: [{ name: "X", alias: "1", datatype: 10, doubleValue: 1 }] }, { msgType: "NBIRTH", group: "G", edgeNode: "N" });
    const d3 = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: "X", alias: "1", doubleValue: 2 }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "resolved" });
    const watched = await fold([[b1], [b2], [d3]]);
    // Opening the view: the replay (older NBIRTH from birthRefs, current birth, value) is in flight when d3 arrives live.
    let resolve: (v: any) => void = () => {};
    mocks.getSparkplugHistory.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    mocks.handlers.clear();
    const store = createSparkplugTreeStore(1, eventSet);
    store.init();
    const opened = store.activate();
    emit("msgs", [d3]);
    resolve({ messages: [b1, b2, d3], suspendedOrd: 0 });
    await opened;
    const unit = get(store).groups[0].nodes[0].metrics[0].unit;
    store.destroy();
    expect({ unit }).toEqual({ unit: watched.groups[0].nodes[0].metrics[0].unit });
  });
  it("F9 fuzz: re-delivering already-seen births and deaths, compliant sessions with 2 devices and long runs", async () => {
    const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
    const failures: string[] = [];
    for (let seed = 1; seed <= 800 && failures.length < 2; seed++) {
      const r = rng(seed * 7919 + 13);
      n = 0;
      const session: any[] = [];
      let nodeUp = false;
      const devUp: Record<string, boolean> = { D1: false, D2: false };
      const len = 10 + Math.floor(r() * 50);
      while (session.length < len) {
        const x = r();
        const dev = r() < 0.5 ? "D1" : "D2";
        let m: any = null;
        if (!nodeUp) {
          m = mk("spBv1.0/G/NBIRTH/N", { metrics: [{ name: "X", alias: "1", datatype: 3, intValue: 1 }, { name: "Y", alias: "2", datatype: 7, intValue: 2, ...(r() < 0.5 ? { properties: { keys: ["engUnit"], values: [{ type: 12, stringValue: "V" }] } } : {}) }] }, { msgType: "NBIRTH", group: "G", edgeNode: "N" });
          nodeUp = true; devUp.D1 = devUp.D2 = false;
        } else if (x < 0.2) {
          m = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: r() < 0.5 ? "X" : "Y", intValue: Math.floor(r() * 9) }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "resolved" });
        } else if (x < 0.45) {
          m = devUp[dev]
            ? mk(`spBv1.0/G/DDATA/N/${dev}`, { metrics: [{ name: r() < 0.5 ? "T" : "U", intValue: Math.floor(r() * 9) }] }, { msgType: "DDATA", group: "G", edgeNode: "N", device: dev, resolution: "resolved" })
            : mk(`spBv1.0/G/DBIRTH/N/${dev}`, { metrics: [{ name: "T", alias: "1", datatype: r() < 0.5 ? 3 : 7, intValue: 0 }, ...(r() < 0.5 ? [{ name: "U", alias: "2", datatype: 3, intValue: 0 }] : [])] }, { msgType: "DBIRTH", group: "G", edgeNode: "N", device: dev });
          devUp[dev] = true;
        } else if (x < 0.55 && devUp[dev]) {
          m = mk(`spBv1.0/G/DDEATH/N/${dev}`, "", { msgType: "DDEATH", group: "G", edgeNode: "N", device: dev }); devUp[dev] = false;
        } else if (x < 0.65) {
          m = mk("spBv1.0/G/NDEATH/N", "", { msgType: "NDEATH", group: "G", edgeNode: "N" }); nodeUp = false;
        } else if (x < 0.72) {
          m = mk("spBv1.0/G/NBIRTH/N", { metrics: [{ name: "X", alias: "1", datatype: 3, intValue: 1 }, { name: "Y", alias: "2", datatype: 7, intValue: 2 }] }, { msgType: "NBIRTH", group: "G", edgeNode: "N" });
          devUp.D1 = devUp.D2 = false;
        } else {
          m = mk("spBv1.0/G/NDATA/N", { metrics: [{ name: "X", intValue: Math.floor(r() * 9) }] }, { msgType: "NDATA", group: "G", edgeNode: "N", resolution: "resolved" });
        }
        if (r() < 0.1) continue; // QoS 0 loss
        session.push(m);
      }
      const live = await fold(session.map((m) => [m]));
      const replay = session.filter((m) => /BIRTH|DEATH/.test(m.middlewareProperties.sparkplug.msgType));
      const withReplay = await fold([...session.map((m) => [m]), replay]);
      if (JSON.stringify(live) !== JSON.stringify(withReplay)) {
        failures.push(`seed ${seed}: ${session.map((m) => m.middlewareProperties.sparkplug.msgType + (m.middlewareProperties.sparkplug.device ?? "") + "#" + m.middlewareProperties.sparkplug.n).join(",")}\n live ${JSON.stringify(live.groups)}\n +replay ${JSON.stringify(withReplay.groups)}`);
      }
    }
    if (failures.length) console.log(failures.join("\n\n"));
    expect(failures).toEqual([]);
  }, 120_000);
});
