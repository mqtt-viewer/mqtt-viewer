import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import type * as events from "bindings/mqtt-viewer/events/models";
import {
  createSelectedTopicStore,
  HISTORY_WINDOW_SIZE,
  MAX_LOADED_MESSAGES,
  type HistoryDelta,
} from "./selected-topic-store";

const GetMessageTimeline = vi.fn();
const GetMessageById = vi.fn();
const GetMessageHistory = vi.fn();
const GetReceivedTimelineWindow = vi.fn();
const GetReceivedMessageWindow = vi.fn();
const GetReceivedMessageById = vi.fn();
const GetReceivedMessageCount = vi.fn();
const GetAppSettings = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetMessageTimeline: (...args: unknown[]) => GetMessageTimeline(...args),
  GetMessageById: (...args: unknown[]) => GetMessageById(...args),
  GetMessageHistory: (...args: unknown[]) => GetMessageHistory(...args),
  GetReceivedTimelineWindow: (...args: unknown[]) =>
    GetReceivedTimelineWindow(...args),
  GetReceivedMessageWindow: (...args: unknown[]) =>
    GetReceivedMessageWindow(...args),
  GetReceivedMessageById: (...args: unknown[]) =>
    GetReceivedMessageById(...args),
  GetReceivedMessageCount: (...args: unknown[]) =>
    GetReceivedMessageCount(...args),
  GetAppSettings: (...args: unknown[]) => GetAppSettings(...args),
}));

const listeners = new Map<string, (e: any) => void>();

vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: vi.fn((eventName: string, handler: (e: any) => void) => {
      listeners.set(eventName, handler);
      return () => listeners.delete(eventName);
    }),
  },
}));

const CONNECTION_ID = 1;
const connectionEventSet = {
  mqttConnected: "mqttConnected",
  mqttDisconnected: "mqttDisconnected",
  mqttConnecting: "mqttConnecting",
  mqttReconnecting: "mqttReconnecting",
  mqttClientError: "mqttClientError",
  mqttMessages: "mqttMessages",
  mqttLatency: "mqttLatency",
  mqttClearHistory: "mqttClearHistory",
} as unknown as events.ConnectionEventsSet;

// Lightweight stub, matching what GetMessageTimeline/GetReceivedTimelineWindow
// return: id, timeMs, qos, retain, no payload.
const makeStubs = (startId: number, count: number) =>
  Array.from({ length: count }, (_, i) => {
    const id = startId + i;
    return {
      id: String(id),
      timeMs: id * 1000,
      qos: 0,
      retain: false,
    };
  });

// A full message (with payload), as returned by GetMessageById/
// GetReceivedMessageById/GetMessageHistory/GetReceivedMessageWindow.
const makeMessages = (
  startId: number,
  count: number,
  topic = "a/b"
): mqtt.MqttMessage[] =>
  Array.from({ length: count }, (_, i) => {
    const id = startId + i;
    return {
      id: String(id),
      topic,
      payload: btoa("payload-" + id),
      timeMs: id * 1000,
      retain: false,
    } as unknown as mqtt.MqttMessage;
  });

const fireLiveMessage = (message: Partial<mqtt.MqttMessage>) => {
  const handler = listeners.get(connectionEventSet.mqttMessages);
  if (!handler) throw new Error("no mqttMessages listener registered");
  handler({ data: [message] });
};

// Manually resolvable promise, for controlling fetch timing in tests.
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  GetAppSettings.mockResolvedValue({ recordingEnabled: true });
  // Default: ensurePayload's auto-fetch-newest call (fired at the end of
  // selectTopic/jumpToLatest) resolves to something innocuous unless a test
  // overrides it with a mockResolvedValueOnce. found=true, echoing back the
  // requested id/topic so it doesn't clobber the stub's real id.
  GetReceivedMessageById.mockImplementation(
    async (_connId: number, topic: string, id: number) => [
      { id: String(id), topic, payload: btoa("auto"), timeMs: 0, retain: false },
      true,
    ]
  );
  GetMessageById.mockImplementation(
    async (_connId: number, topic: string, id: string) => [
      { id, topic, payload: btoa("auto"), timeMs: 0, retain: false },
      true,
    ]
  );
});

describe("selectTopic (disk mode)", () => {
  it("loads a stub window (no payloads) and sets history/window/count", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const stubs = makeStubs(1, 10);
    GetReceivedTimelineWindow.mockResolvedValue(stubs);
    GetReceivedMessageCount.mockResolvedValue(10);

    await store.selectTopic("a/b");

    expect(GetReceivedTimelineWindow).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      0,
      0,
      HISTORY_WINDOW_SIZE
    );

    const s = get(store);
    expect(s.history).toHaveLength(10);
    // Stubs carry no payload until fetched.
    expect(s.history[0].payload).toBeNull();
    expect(s.history[0].payloadB64).toBeNull();
    expect(s.history[0].payloadState).toBe("unfetched");
    expect(s.window).toEqual({
      oldestId: 1,
      newestId: 10,
      isNewest: true,
      atOldest: true,
    });
    expect(s.totalCount).toBe(10);
    expect(s.isLoadingHistory).toBe(false);
    expect(s.historyRevision).toBeGreaterThan(0);

    unsub();
  });

  it("marks atOldest false when the window is full", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const stubs = makeStubs(7001, HISTORY_WINDOW_SIZE);
    GetReceivedTimelineWindow.mockResolvedValue(stubs);
    GetReceivedMessageCount.mockResolvedValue(12000);

    await store.selectTopic("a/b");

    const s = get(store);
    expect(s.history).toHaveLength(HISTORY_WINDOW_SIZE);
    expect(s.window?.atOldest).toBe(false);
    expect(s.totalCount).toBe(12000);

    unsub();
  });

  it("fetches exactly one payload (the newest stub) after the stub window lands", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 10));
    GetReceivedMessageCount.mockResolvedValue(10);
    GetReceivedMessageById.mockResolvedValueOnce([
      { id: "10", topic: "a/b", payload: btoa("newest"), timeMs: 10000, retain: false },
      true,
    ]);

    await store.selectTopic("a/b");
    // ensurePayload for the newest stub is fired-and-forgotten at the end of
    // selectTopic; flush microtasks so it lands.
    await Promise.resolve();
    await Promise.resolve();

    expect(GetReceivedMessageById).toHaveBeenCalledWith(CONNECTION_ID, "a/b", 10);
    expect(GetReceivedMessageById).toHaveBeenCalledTimes(1);

    const s = get(store);
    expect(s.history[9].payload).toBe("newest");
    expect(s.history[9].payloadState).toBe("loaded");
    // Everything else is still unfetched.
    expect(s.history[0].payloadState).toBe("unfetched");

    unsub();
  });
});

describe("selectTopic (memory mode)", () => {
  it("loads stubs via GetMessageTimeline with the window-size limit", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const stubs = makeStubs(1, 10);
    GetMessageTimeline.mockResolvedValue(stubs);

    await store.selectTopic("a/b");

    expect(GetMessageTimeline).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      HISTORY_WINDOW_SIZE
    );

    const s = get(store);
    expect(s.historySource).toBe("memory");
    expect(s.history).toHaveLength(10);
    expect(s.history[0].payload).toBeNull();
    expect(s.window).toBeNull();

    unsub();
  });

  it("caps live appends at MAX_LOADED_MESSAGES and emits a trim delta", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, MAX_LOADED_MESSAGES));
    await store.selectTopic("a/b");

    expect(get(store).history).toHaveLength(MAX_LOADED_MESSAGES);

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    fireLiveMessage({
      id: "live-1",
      topic: "a/b",
      payload: btoa("payload-live"),
      timeMs: 999999,
      retain: false,
    });

    const s = get(store);
    expect(s.history).toHaveLength(MAX_LOADED_MESSAGES);
    expect(s.history[s.history.length - 1].id).toBe("live-1");
    expect(s.history[0].id).toBe("2");

    expect(deltas.some((d) => d.kind === "trim")).toBe(true);
    const trim = deltas.find((d) => d.kind === "trim");
    if (trim?.kind === "trim") {
      expect(trim.ids).toEqual(["1"]);
    }

    unsub();
  });
});

describe("ensurePayload", () => {
  it("fetches and decodes a message by id in disk mode, marking it loaded", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    // Let the auto-fetch of the newest stub settle first.
    await Promise.resolve();
    await Promise.resolve();

    GetReceivedMessageById.mockResolvedValueOnce([
      { id: "2", topic: "a/b", payload: btoa("hello"), timeMs: 2000, retain: true },
      true,
    ]);

    await store.ensurePayload("2");

    expect(GetReceivedMessageById).toHaveBeenCalledWith(CONNECTION_ID, "a/b", 2);
    const s = get(store);
    const msg = s.history.find((m) => m.id === "2");
    expect(msg?.payload).toBe("hello");
    expect(msg?.payloadState).toBe("loaded");
    expect(msg?.retain).toBe(true);

    unsub();
  });

  it("fetches by id in memory mode via GetMessageById", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, 5));
    await store.selectTopic("a/b");
    await Promise.resolve();
    await Promise.resolve();

    GetMessageById.mockResolvedValueOnce([
      { id: "3", topic: "a/b", payload: btoa("mem-hello"), timeMs: 3000, retain: false },
      true,
    ]);

    await store.ensurePayload("3");

    expect(GetMessageById).toHaveBeenCalledWith(CONNECTION_ID, "a/b", "3");
    const s = get(store);
    const msg = s.history.find((m) => m.id === "3");
    expect(msg?.payload).toBe("mem-hello");
    expect(msg?.payloadState).toBe("loaded");

    unsub();
  });

  it("is a no-op (no extra fetch) when the payload is already loaded", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await Promise.resolve();
    await Promise.resolve();

    const callsForId2 = () =>
      GetReceivedMessageById.mock.calls.filter((c) => c[2] === 2).length;

    GetReceivedMessageById.mockResolvedValueOnce([
      { id: "2", topic: "a/b", payload: btoa("hello"), timeMs: 2000, retain: false },
      true,
    ]);
    await store.ensurePayload("2");
    expect(callsForId2()).toBe(1);

    // Second call for the same, now-loaded id must not re-fetch.
    await store.ensurePayload("2");
    expect(callsForId2()).toBe(1);

    unsub();
  });

  it("marks the stub aged-out when the backend reports not found", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await Promise.resolve();
    await Promise.resolve();

    GetReceivedMessageById.mockResolvedValueOnce([
      { id: "", topic: "", payload: "", timeMs: 0, retain: false },
      false,
    ]);

    await store.ensurePayload("2");

    const s = get(store);
    const msg = s.history.find((m) => m.id === "2");
    expect(msg?.payloadState).toBe("aged-out");
    expect(msg?.payload).toBeNull();

    unsub();
  });

  it("marks the stub aged-out gracefully when the fetch rejects", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await Promise.resolve();
    await Promise.resolve();

    GetReceivedMessageById.mockRejectedValueOnce(new Error("boom"));

    await store.ensurePayload("2");

    const s = get(store);
    const msg = s.history.find((m) => m.id === "2");
    expect(msg?.payloadState).toBe("aged-out");

    unsub();
  });

  it("no-ops for an id not present in history", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await Promise.resolve();
    await Promise.resolve();

    const callsBefore = GetReceivedMessageById.mock.calls.length;
    await store.ensurePayload("does-not-exist");
    expect(GetReceivedMessageById.mock.calls.length).toBe(callsBefore);

    unsub();
  });

  it("discards a stale ensurePayload result after selecting a different topic (race)", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await Promise.resolve();
    await Promise.resolve();

    const inFlight = deferred<[mqtt.MqttMessage, boolean]>();
    GetReceivedMessageById.mockReturnValueOnce(inFlight.promise);
    const ensurePromise = store.ensurePayload("2");

    // User selects a different topic while the fetch for "2" is in flight.
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(1, 3)
    );
    GetReceivedMessageCount.mockResolvedValue(3);
    await store.selectTopic("other/topic");
    await Promise.resolve();
    await Promise.resolve();

    // The stale fetch for "2" (on the old topic) now resolves.
    inFlight.resolve([
      {
        id: "2",
        topic: "a/b",
        payload: btoa("stale"),
        timeMs: 2000,
        retain: false,
      } as unknown as mqtt.MqttMessage,
      true,
    ]);
    await ensurePromise;

    const s = get(store);
    expect(s.selectedTopic).toBe("other/topic");
    // The stale result must not have landed in the new topic's history.
    expect(s.history.every((m) => m.payload !== "stale")).toBe(true);

    unsub();
  });
});

describe("loadOlderWindow", () => {
  it("prepends the next older stub window, keeping ascending order", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const firstWindow = makeStubs(5001, HISTORY_WINDOW_SIZE);
    GetReceivedTimelineWindow.mockResolvedValueOnce(firstWindow);
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    const olderWindow = makeStubs(1, HISTORY_WINDOW_SIZE);
    GetReceivedTimelineWindow.mockResolvedValueOnce(olderWindow);

    await store.loadOlderWindow();

    expect(GetReceivedTimelineWindow).toHaveBeenLastCalledWith(
      CONNECTION_ID,
      "a/b",
      5001,
      0,
      HISTORY_WINDOW_SIZE
    );

    const s = get(store);
    expect(s.history).toHaveLength(10000);
    expect(s.history[0].id).toBe("1");
    expect(s.history[0].payload).toBeNull();
    for (let i = 1; i < s.history.length; i++) {
      expect(Number(s.history[i].id)).toBeGreaterThan(
        Number(s.history[i - 1].id)
      );
    }
    expect(s.window?.oldestId).toBe(1);
    expect(s.window?.atOldest).toBe(false);
    expect(s.isLoadingWindow).toBeNull();

    expect(deltas).toHaveLength(1);
    expect(deltas[0].kind).toBe("prepend");
    if (deltas[0].kind === "prepend") {
      expect(deltas[0].messages).toHaveLength(HISTORY_WINDOW_SIZE);
    }

    unsub();
  });

  it("marks atOldest true when fewer than a full window returns", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(5100);
    await store.selectTopic("a/b");

    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(4901, 100));
    await store.loadOlderWindow();

    const s = get(store);
    expect(s.history).toHaveLength(5100);
    expect(s.window?.atOldest).toBe(true);

    unsub();
  });

  it("leaves history unchanged and atOldest true when zero rows return", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(5000);
    await store.selectTopic("a/b");
    const before = get(store).history;

    GetReceivedTimelineWindow.mockResolvedValueOnce([]);
    await store.loadOlderWindow();

    const s = get(store);
    expect(s.history).toHaveLength(before.length);
    expect(s.window?.atOldest).toBe(true);

    unsub();
  });
});

describe("cap eviction on prepend", () => {
  it("evicts the newest messages once MAX_LOADED_MESSAGES is exceeded", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    // selectTopic: newest window is ids 15001..20000.
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(15001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(30000);
    await store.selectTopic("a/b");

    // Three loadOlderWindow calls of 5000 each: 10001-15000, 5001-10000, 1-5000.
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(10001, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(5001, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(1, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();

    let s = get(store);
    expect(s.history).toHaveLength(20000);
    // Before the fourth load, ids run 1..20000 in order; the newest 5000
    // (ids 15001..20000) are what the eviction below must remove.
    expect(s.history[0].id).toBe("1");
    expect(s.history[s.history.length - 1].id).toBe("20000");

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    // A fourth loadOlderWindow of 5000 (ids -4999..0) pushes total to 25000,
    // triggering eviction of 5000 from the newest end.
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(1 - HISTORY_WINDOW_SIZE, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();

    s = get(store);
    expect(s.history).toHaveLength(MAX_LOADED_MESSAGES);
    // Kept: the oldest MAX_LOADED_MESSAGES of the 25000 total, i.e. ids
    // (1 - HISTORY_WINDOW_SIZE) .. 15000. The newest 5000 (15001..20000) are evicted.
    expect(s.history[0].id).toBe(String(1 - HISTORY_WINDOW_SIZE));
    expect(s.history[s.history.length - 1].id).toBe("15000");

    // loadOlderWindow emits its own "prepend" delta first, then enforceCap
    // emits the "trim" delta for the evicted newest messages.
    expect(deltas).toHaveLength(2);
    expect(deltas[0].kind).toBe("prepend");
    expect(deltas[1].kind).toBe("trim");
    const trim = deltas[1];
    if (trim.kind === "trim") {
      expect(trim.ids).toHaveLength(HISTORY_WINDOW_SIZE);
      expect(trim.ids[0]).toBe("15001");
      expect(trim.ids[trim.ids.length - 1]).toBe("20000");
    }

    expect(s.window?.isNewest).toBe(false);
    expect(s.window?.newestId).toBe(15000);

    unsub();
  });
});

describe("live append", () => {
  it("appends a live message for the selected topic while at the newest window", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 10));
    GetReceivedMessageCount.mockResolvedValue(10);
    await store.selectTopic("a/b");

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    const before = get(store);
    expect(before.window?.isNewest).toBe(true);
    const newestIdBefore = before.window?.newestId;

    fireLiveMessage({
      id: "abc-123",
      topic: "a/b",
      payload: btoa("payload-live"),
      timeMs: 999999,
      retain: false,
    });

    const s = get(store);
    expect(s.history).toHaveLength(11);
    expect(s.history[s.history.length - 1].id).toBe("abc-123");
    expect(s.history[s.history.length - 1].payload).toBe("payload-live");
    expect(s.history[s.history.length - 1].payloadState).toBe("loaded");
    expect(s.totalCount).toBe(11);
    // A uuid live id must not move the numeric cursor.
    expect(s.window?.newestId).toBe(newestIdBefore);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].kind).toBe("append");
    if (deltas[0].kind === "append") {
      expect(deltas[0].messages).toHaveLength(1);
      expect(deltas[0].messages[0].id).toBe("abc-123");
    }

    unsub();
  });

  it("is ignored when the window is not the newest (e.g. after a cap eviction)", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(15001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(30000);
    await store.selectTopic("a/b");

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(10001, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(5001, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(1, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(1 - HISTORY_WINDOW_SIZE, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();

    const before = get(store);
    expect(before.window?.isNewest).toBe(false);
    const historyLengthBefore = before.history.length;

    fireLiveMessage({
      id: "def-456",
      topic: "a/b",
      payload: btoa("payload-live"),
      timeMs: 999999,
      retain: false,
    });

    const s = get(store);
    expect(s.history).toHaveLength(historyLengthBefore);

    unsub();
  });
});

describe("single-flight guard on loadOlderWindow", () => {
  it("only fetches once for concurrent calls", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");

    const olderDeferred = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(olderDeferred.promise);

    const callsBefore = GetReceivedTimelineWindow.mock.calls.length;
    const p1 = store.loadOlderWindow();
    const p2 = store.loadOlderWindow();

    expect(GetReceivedTimelineWindow.mock.calls.length).toBe(callsBefore + 1);
    expect(get(store).isLoadingWindow).toBe("older");

    olderDeferred.resolve(makeStubs(1, HISTORY_WINDOW_SIZE));
    await Promise.all([p1, p2]);

    expect(get(store).isLoadingWindow).toBeNull();

    unsub();
  });
});

describe("staleness guard", () => {
  it("ignores a stale loadOlderWindow result after selecting a different topic", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");

    const olderDeferred = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(olderDeferred.promise);
    const olderPromise = store.loadOlderWindow();

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(1, 5)
    );
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("other/topic");

    olderDeferred.resolve(makeStubs(1, HISTORY_WINDOW_SIZE));
    await olderPromise;

    const s = get(store);
    expect(s.selectedTopic).toBe("other/topic");
    expect(s.history).toHaveLength(5);

    unsub();
  });
});

describe("jumpToLatest", () => {
  it("invalidates an in-flight older load and replaces history wholesale", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");
    const revisionBefore = get(store).historyRevision;

    const olderDeferred = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(olderDeferred.promise);
    const olderPromise = store.loadOlderWindow();

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(15001, HISTORY_WINDOW_SIZE)
    );
    const jumpPromise = store.jumpToLatest();

    olderDeferred.resolve(makeStubs(1, HISTORY_WINDOW_SIZE));
    await Promise.all([olderPromise, jumpPromise]);

    const s = get(store);
    expect(s.history).toHaveLength(HISTORY_WINDOW_SIZE);
    expect(s.history[0].id).toBe("15001");
    expect(s.history[s.history.length - 1].id).toBe("20000");
    expect(s.historyRevision).toBeGreaterThan(revisionBefore);

    unsub();
  });
});

describe("ensureChartHistory", () => {
  it("fetches the full-payload window via the full-message binding, once", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");

    GetReceivedMessageWindow.mockResolvedValueOnce(makeMessages(1, 5));

    await store.ensureChartHistory();

    expect(GetReceivedMessageWindow).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      0,
      0,
      HISTORY_WINDOW_SIZE
    );
    const s = get(store);
    expect(s.chartHistory).toHaveLength(5);
    expect(s.chartHistory?.[0].payload).toBe("payload-1");

    // A second call must not re-fetch: already loaded.
    await store.ensureChartHistory();
    expect(GetReceivedMessageWindow).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("uses GetMessageHistory in memory mode", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, 5));
    await store.selectTopic("a/b");

    GetMessageHistory.mockResolvedValueOnce(makeMessages(1, 5));

    await store.ensureChartHistory();

    expect(GetMessageHistory).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      HISTORY_WINDOW_SIZE
    );
    const s = get(store);
    expect(s.chartHistory).toHaveLength(5);

    unsub();
  });

  it("resets the chart cache on a new topic selection", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    GetReceivedMessageWindow.mockResolvedValueOnce(makeMessages(1, 5));
    await store.ensureChartHistory();
    expect(get(store).chartHistory).not.toBeNull();

    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 3));
    GetReceivedMessageCount.mockResolvedValue(3);
    await store.selectTopic("other/topic");

    expect(get(store).chartHistory).toBeNull();

    unsub();
  });
});
