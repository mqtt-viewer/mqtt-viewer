import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { get } from "svelte/store";

// --- Mocks (hoisted so the vi.mock factories can see them) --------------------

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

import {
  createBrokerStatusStore,
  OBSERVED_MSG_KEY,
  OBSERVED_BYTE_KEY,
  type BrokerStatusState,
  type BrokerTileView,
} from "./broker-status-store";

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
const msg = (topic: string, payload: string, timeMs: number) =>
  ({
    id: String(nextId++),
    topic,
    payload: b64(payload),
    qos: 0,
    retain: false,
    timeMs,
    middlewareProperties: null,
  }) as any;

const tile = (state: BrokerStatusState, key: string): BrokerTileView => {
  const t = state.tiles.find((x) => x.key === key);
  if (!t) throw new Error(`no tile ${key}: have ${state.tiles.map((x) => x.key)}`);
  return t;
};

const customTile = (state: BrokerStatusState): BrokerTileView => {
  const t = state.tiles.find((x) => x.key.startsWith("custom:"));
  if (!t) throw new Error("no custom tile");
  return t;
};

const BASE_MS = 1_000_000_000; // fixed epoch base for deterministic buckets

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE_MS));
  mocks.handlers.clear();
  mocks.getSys.mockReset().mockResolvedValue([]);
  mocks.getHist.mockReset().mockResolvedValue([]);
  mocks.getMappings.mockReset().mockResolvedValue([]);
  nextId = 1;
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests --------------------------------------------------------------------

describe("createBrokerStatusStore — backfill", () => {
  it("backfills $SYS history into tiles and the raw browser", async () => {
    mocks.getSys.mockResolvedValue([
      msg("$SYS/broker/clients/connected", "5", BASE_MS - 2000),
      msg("$SYS/broker/subscriptions/count", "3", BASE_MS - 1000),
      msg("$SYS/broker/version", "mosquitto 2.0.18", BASE_MS - 1000),
    ]);
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    const state = get(store);

    expect(tile(state, "clients_connected").display).toBe("5");
    expect(tile(state, "subscriptions").display).toBe("3");
    expect(tile(state, "version").display).toBe("mosquitto 2.0.18");
    expect(tile(state, "version").valueKind).toBe("text");

    expect(state.latestByTopic.get("$SYS/broker/clients/connected")).toEqual({
      value: "5",
      timeMs: BASE_MS - 2000,
    });
    expect(state.sysEverSeen).toBe(true);
    store.destroy();
  });

  it("backfills a custom non-$SYS topic via exact-topic history", async () => {
    mocks.getMappings.mockResolvedValue([
      {
        id: 1,
        connectionId: CONN,
        metricKey: "",
        label: "Line temp",
        topic: "factory/line0/temp",
        payloadPath: "",
        unit: "C",
        sortOrder: 0,
      },
    ]);
    mocks.getHist.mockResolvedValue([msg("factory/line0/temp", "42", BASE_MS)]);

    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    const state = get(store);

    expect(mocks.getHist).toHaveBeenCalledWith(CONN, "factory/line0/temp", 0);
    expect(state.latestByTopic.get("factory/line0/temp")?.value).toBe("42");
    const ct = customTile(state);
    expect(ct.label).toBe("Line temp");
    expect(ct.display).toBe("42 C");
    store.destroy();
  });

  it("does not call GetMessageHistory for $SYS mapping topics", async () => {
    mocks.getMappings.mockResolvedValue([
      {
        id: 1,
        connectionId: CONN,
        metricKey: "clients_connected",
        label: "",
        topic: "$SYS/broker/clients/active",
        payloadPath: "",
        unit: "",
        sortOrder: 0,
      },
    ]);
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    expect(mocks.getHist).not.toHaveBeenCalled();
    store.destroy();
  });

  it("treats a GetMessageHistory rejection as empty history (unpublished topic)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getMappings.mockResolvedValue([
      {
        id: 1,
        connectionId: CONN,
        metricKey: "",
        label: "Line temp",
        topic: "factory/line0/temp",
        payloadPath: "",
        unit: "C",
        sortOrder: 0,
      },
    ]);
    // GetMessageHistory rejects for a topic that hasn't published yet.
    mocks.getHist.mockRejectedValue(
      new Error("topic not found in message history")
    );

    const store = createBrokerStatusStore(CONN, eventSet);
    await expect(store.init()).resolves.toBeUndefined();
    const state = get(store);
    // The custom tile exists but has no data; init still completed and the
    // observed-rate ticker is running.
    expect(customTile(state).valueKind).toBe("empty");
    expect(vi.getTimerCount()).toBe(1);
    store.destroy();
    errSpy.mockRestore();
  });

  it("keeps init alive (and starts the ticker) when the $SYS backfill rejects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getSys.mockRejectedValue(new Error("backend boom"));
    const store = createBrokerStatusStore(CONN, eventSet);
    await expect(store.init()).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(1); // ticker started despite the rejection
    store.destroy();
    errSpy.mockRestore();
  });
});

describe("createBrokerStatusStore — live batches", () => {
  it("coalesces to one store write per batch event", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();

    let n = 0;
    const unsub = store.subscribe(() => n++); // initial subscribe call = 1
    n = 0;

    emit("msgs", [
      msg("$SYS/broker/clients/connected", "1", BASE_MS),
      msg("$SYS/broker/subscriptions/count", "2", BASE_MS),
      msg("factory/a", "x", BASE_MS),
    ]);

    expect(n).toBe(1); // exactly one coalesced write for the whole batch
    unsub();
    store.destroy();
  });

  it("updates a gauge tile from a live batch", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    emit("msgs", [msg("$SYS/broker/clients/connected", "12", BASE_MS)]);
    expect(tile(get(store), "clients_connected").display).toBe("12");
    store.destroy();
  });
});

describe("createBrokerStatusStore — observed rates", () => {
  it("computes msgs/s and bytes/s over the full warmed window", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();

    // Warm past the 60 s window so the divisor is the full window (not the
    // warm-up elapsed time — see the dedicated warm-up test below).
    vi.advanceTimersByTime(60_000);

    // 120 messages this second, payload "hello" → base64 "aGVsbG8=" (len 8)
    // → floor(8*3/4)=6 bytes each.
    const batch = Array.from({ length: 120 }, () =>
      msg("factory/x", "hello", Date.now())
    );
    emit("msgs", batch);

    vi.advanceTimersByTime(1000); // ticker tick
    const state = get(store);
    expect(tile(state, OBSERVED_MSG_KEY).value).toBeCloseTo(120 / 60, 6);
    expect(tile(state, OBSERVED_BYTE_KEY).value).toBeCloseTo((120 * 6) / 60, 6);
    store.destroy();
  });

  it("warm-up: divides by elapsed time (not the full window) before 60 s", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();

    // Steady 10 msgs/s for 5 s from open.
    for (let i = 0; i < 5; i++) {
      emit(
        "msgs",
        Array.from({ length: 10 }, () => msg("t", "hi", Date.now()))
      );
      vi.advanceTimersByTime(1000);
    }

    // 50 msgs collected over 5 s → 10/s, not the under-reported 50/60 ≈ 0.83.
    expect(tile(get(store), OBSERVED_MSG_KEY).value).toBeCloseTo(10, 6);
    store.destroy();
  });

  it("resets a reused bucket on wraparound (61 s later, same slot)", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();

    // 10 msgs at second N.
    emit(
      "msgs",
      Array.from({ length: 10 }, () => msg("t", "hi", Date.now()))
    );
    // 61 s later the ring slot (sec % 61) is reused: it must be reset, not
    // accumulated. advanceTimersByTime keeps Date.now() and the ticker in sync.
    vi.advanceTimersByTime(61_000);
    emit(
      "msgs",
      Array.from({ length: 5 }, () => msg("t", "hi", Date.now()))
    );

    vi.advanceTimersByTime(1000);
    // Only the 5 newest count; the stale 10 were overwritten in the same slot.
    expect(tile(get(store), OBSERVED_MSG_KEY).value).toBeCloseTo(5 / 60, 6);
    store.destroy();
  });

  it("freezes the observed ticker while disconnected", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    emit("disc");
    expect(get(store).connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0); // ticker cleared
    emit("conn");
    expect(get(store).connected).toBe(true);
    expect(vi.getTimerCount()).toBe(1); // ticker restarted
    store.destroy();
  });
});

describe("createBrokerStatusStore — cumulative rate derivation", () => {
  const EMQX = "$SYS/brokers/emqx@127.0.0.1/metrics/messages/received";

  it("derives a /s rate from successive counter samples", async () => {
    mocks.getSys.mockResolvedValue([
      msg(EMQX, "100", BASE_MS - 2000),
      msg(EMQX, "250", BASE_MS), // +150 over 2 s → 75/s
    ]);
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    expect(tile(get(store), "msg_rate_in").value).toBeCloseTo(75, 6);
    store.destroy();
  });

  it("clamps a negative delta (counter reset) to zero", async () => {
    mocks.getSys.mockResolvedValue([
      msg(EMQX, "100", BASE_MS - 2000),
      msg(EMQX, "250", BASE_MS),
    ]);
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    // Broker restart: counter drops below the previous value.
    emit("msgs", [msg(EMQX, "50", BASE_MS + 2000)]);
    expect(tile(get(store), "msg_rate_in").value).toBe(0);
    store.destroy();
  });

  it("reseeds (no spike sample) when the winning cumulative topic switches", async () => {
    const nodeB = "$SYS/brokers/emqxB@127.0.0.1/metrics/messages/received";
    const nodeA = "$SYS/brokers/emqxA@127.0.0.1/metrics/messages/received";
    mocks.getSys.mockResolvedValue([
      msg(nodeB, "1000", BASE_MS - 3000),
      msg(nodeB, "1100", BASE_MS - 2000), // +100 over 1 s → 100/s
      // A lexicographically smaller node appears and becomes the winner. Its
      // 9000 must NOT be diffed against nodeB's 1100 (a bogus ~7900/s spike).
      msg(nodeA, "9000", BASE_MS - 1000),
    ]);
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    const t = tile(get(store), "msg_rate_in");
    expect(t.samples.map((s) => s.v)).toEqual([100]);
    expect(t.value).toBeCloseTo(100, 6);
    store.destroy();
  });
});

describe("createBrokerStatusStore — reset & reload", () => {
  it("resets everything on the clear-history event", async () => {
    mocks.getSys.mockResolvedValue([
      msg("$SYS/broker/clients/connected", "9", BASE_MS),
    ]);
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    expect(tile(get(store), "clients_connected").display).toBe("9");

    emit("clear");
    const state = get(store);
    expect(tile(state, "clients_connected").valueKind).toBe("empty");
    expect(state.latestByTopic.size).toBe(0);
    expect(state.sysEverSeen).toBe(false);
    store.destroy();
  });

  it("discards a history backfill whose clear-history landed mid-fetch", async () => {
    // GetSysMessageHistory stays pending until we resolve it; `called` fires
    // once init has invoked it (so the epoch is already captured).
    let resolveHist!: (v: any) => void;
    let signalCalled!: () => void;
    const called = new Promise<void>((r) => (signalCalled = r));
    mocks.getSys.mockImplementation(() => {
      signalCalled();
      return new Promise((res) => (resolveHist = res));
    });

    const store = createBrokerStatusStore(CONN, eventSet);
    const initPromise = store.init();
    await called; // $SYS fetch is in flight; epoch captured

    emit("clear"); // history cleared while the fetch is pending → bumps epoch
    resolveHist([msg("$SYS/broker/clients/connected", "42", BASE_MS)]);
    await initPromise;

    const state = get(store);
    // The pre-clear history must not resurrect: tile stays empty, browser empty.
    expect(tile(state, "clients_connected").valueKind).toBe("empty");
    expect(state.latestByTopic.size).toBe(0);
    expect(state.sysEverSeen).toBe(false);
    store.destroy();
  });

  it("keeps a surviving custom tile's runtime when an earlier row is deleted", async () => {
    const rowA = {
      id: 10, connectionId: CONN, metricKey: "", label: "A",
      topic: "app/a", payloadPath: "", unit: "", sortOrder: 1,
    };
    const rowB = {
      id: 20, connectionId: CONN, metricKey: "", label: "B",
      topic: "app/b", payloadPath: "", unit: "", sortOrder: 2,
    };
    mocks.getMappings.mockResolvedValue([rowA, rowB]);
    mocks.getHist.mockImplementation((_c: number, topic: string) =>
      Promise.resolve(
        topic === "app/a"
          ? [msg("app/a", "1", BASE_MS - 1000), msg("app/a", "2", BASE_MS)]
          : topic === "app/b"
            ? [msg("app/b", "10", BASE_MS - 1000), msg("app/b", "20", BASE_MS)]
            : []
      )
    );

    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    const tileB = () => tile(get(store), "custom:20");
    const before = tileB().samples;
    expect(before).toHaveLength(2);

    // Delete row A: reload with only row B. Its runtime (sparkline) must survive
    // because its stable id-based key doesn't shift when A is removed.
    mocks.getMappings.mockResolvedValue([rowB]);
    await store.reloadMappings();
    const after = tileB().samples;
    expect(after).toBe(before); // same runtime object, not reset to []
    expect(after).toHaveLength(2);
    store.destroy();
  });

  it("preserves existing samples for unchanged tiles across a reload", async () => {
    const mapping = {
      id: 1,
      connectionId: CONN,
      metricKey: "",
      label: "Temp",
      topic: "app/temp",
      payloadPath: "",
      unit: "",
      sortOrder: 0,
    };
    mocks.getMappings.mockResolvedValue([mapping]);
    mocks.getHist.mockResolvedValue([
      msg("app/temp", "10", BASE_MS - 1000),
      msg("app/temp", "20", BASE_MS),
    ]);

    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    const before = customTile(get(store)).samples;
    expect(before).toHaveLength(2);

    await store.reloadMappings();
    const after = customTile(get(store)).samples;
    expect(after).toHaveLength(2); // topic already backfilled → not re-fetched
    expect(after).toEqual(before);
    store.destroy();
  });
});

describe("createBrokerStatusStore — empty state & teardown", () => {
  it("exposes empty-state flags and always-present observed tiles", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    const state = get(store);
    expect(state.sysEverSeen).toBe(false);
    expect(state.connected).toBe(true);
    expect(state.windowOpenedAt).toBe(BASE_MS);
    expect(state.tiles.some((t) => t.key === OBSERVED_MSG_KEY)).toBe(true);
    expect(state.tiles.some((t) => t.key === OBSERVED_BYTE_KEY)).toBe(true);

    emit("msgs", [msg("$SYS/broker/uptime", "60 seconds", BASE_MS)]);
    expect(get(store).sysEverSeen).toBe(true);
    expect(tile(get(store), "uptime").display).toBe("1m");
    store.destroy();
  });

  it("starts the observed ticker when the window is opened while already connected", async () => {
    // Window/instance created *after* the broker connected: no mqttConnected
    // event will fire, so init() must start the ticker off the seeded
    // `connected: true` option, otherwise the observed-rate tiles stay frozen.
    const store = createBrokerStatusStore(CONN, eventSet, { connected: true });
    await store.init();
    expect(get(store).connected).toBe(true);
    expect(vi.getTimerCount()).toBe(1); // ticker running without a connected event
    store.destroy();
  });

  it("leaves the ticker stopped when opened while disconnected until a connect event", async () => {
    const store = createBrokerStatusStore(CONN, eventSet, { connected: false });
    await store.init();
    expect(get(store).connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0); // no ticker while disconnected
    emit("conn");
    expect(get(store).connected).toBe(true);
    expect(vi.getTimerCount()).toBe(1); // a later connect event starts it
    store.destroy();
  });

  it("unbinds all listeners and stops the ticker on destroy", async () => {
    const store = createBrokerStatusStore(CONN, eventSet);
    await store.init();
    expect(vi.getTimerCount()).toBe(1);

    store.destroy();
    expect(vi.getTimerCount()).toBe(0); // no timer leak
    for (const name of ["msgs", "clear", "conn", "disc"]) {
      expect(mocks.handlers.get(name)?.size ?? 0).toBe(0);
    }
    // A late batch after destroy must not mutate the store.
    const snapshot = get(store);
    emit("msgs", [msg("$SYS/broker/clients/connected", "99", BASE_MS)]);
    expect(get(store)).toBe(snapshot);
  });
});
