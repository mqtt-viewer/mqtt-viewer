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

const GetMessageHistory = vi.fn();
const GetReceivedMessageWindow = vi.fn();
const GetReceivedMessageCount = vi.fn();
const GetAppSettings = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetMessageHistory: (...args: unknown[]) => GetMessageHistory(...args),
  GetReceivedMessageWindow: (...args: unknown[]) =>
    GetReceivedMessageWindow(...args),
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
});

describe("selectTopic (disk mode)", () => {
  it("loads the newest window and sets history/window/count", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const msgs = makeMessages(1, 10);
    GetReceivedMessageWindow.mockResolvedValue(msgs);
    GetReceivedMessageCount.mockResolvedValue(10);

    await store.selectTopic("a/b");

    expect(GetReceivedMessageWindow).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      0,
      0,
      HISTORY_WINDOW_SIZE
    );

    const s = get(store);
    expect(s.history).toHaveLength(10);
    expect(s.history[0].payload).toBe("payload-1");
    expect(s.history[0].payloadB64).toBe(btoa("payload-1"));
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

    const msgs = makeMessages(7001, HISTORY_WINDOW_SIZE);
    GetReceivedMessageWindow.mockResolvedValue(msgs);
    GetReceivedMessageCount.mockResolvedValue(12000);

    await store.selectTopic("a/b");

    const s = get(store);
    expect(s.history).toHaveLength(HISTORY_WINDOW_SIZE);
    expect(s.window?.atOldest).toBe(false);
    expect(s.totalCount).toBe(12000);

    unsub();
  });
});

describe("selectTopic (memory mode)", () => {
  it("loads history via GetMessageHistory with the window-size limit", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const msgs = makeMessages(1, 10);
    GetMessageHistory.mockResolvedValue(msgs);

    await store.selectTopic("a/b");

    expect(GetMessageHistory).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      HISTORY_WINDOW_SIZE
    );

    const s = get(store);
    expect(s.historySource).toBe("memory");
    expect(s.history).toHaveLength(10);
    expect(s.window).toBeNull();

    unsub();
  });

  it("caps live appends at MAX_LOADED_MESSAGES and emits a trim delta", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageHistory.mockResolvedValue(makeMessages(1, MAX_LOADED_MESSAGES));
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

describe("loadOlderWindow", () => {
  it("prepends the next older window, keeping ascending order", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const firstWindow = makeMessages(5001, HISTORY_WINDOW_SIZE);
    GetReceivedMessageWindow.mockResolvedValueOnce(firstWindow);
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    const olderWindow = makeMessages(1, HISTORY_WINDOW_SIZE);
    GetReceivedMessageWindow.mockResolvedValueOnce(olderWindow);

    await store.loadOlderWindow();

    expect(GetReceivedMessageWindow).toHaveBeenLastCalledWith(
      CONNECTION_ID,
      "a/b",
      5001,
      0,
      HISTORY_WINDOW_SIZE
    );

    const s = get(store);
    expect(s.history).toHaveLength(10000);
    expect(s.history[0].id).toBe("1");
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

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(5100);
    await store.selectTopic("a/b");

    GetReceivedMessageWindow.mockResolvedValueOnce(makeMessages(4901, 100));
    await store.loadOlderWindow();

    const s = get(store);
    expect(s.history).toHaveLength(5100);
    expect(s.window?.atOldest).toBe(true);

    unsub();
  });

  it("leaves history unchanged and atOldest true when zero rows return", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(5000);
    await store.selectTopic("a/b");
    const before = get(store).history;

    GetReceivedMessageWindow.mockResolvedValueOnce([]);
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
    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(15001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(30000);
    await store.selectTopic("a/b");

    // Three loadOlderWindow calls of 5000 each: 10001-15000, 5001-10000, 1-5000.
    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(10001, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(5001, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(1, HISTORY_WINDOW_SIZE)
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
    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(1 - HISTORY_WINDOW_SIZE, HISTORY_WINDOW_SIZE)
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

    GetReceivedMessageWindow.mockResolvedValueOnce(makeMessages(1, 10));
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

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(15001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(30000);
    await store.selectTopic("a/b");

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(10001, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(5001, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(1, HISTORY_WINDOW_SIZE)
    );
    await store.loadOlderWindow();
    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(1 - HISTORY_WINDOW_SIZE, HISTORY_WINDOW_SIZE)
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

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");

    const olderDeferred = deferred<mqtt.MqttMessage[]>();
    GetReceivedMessageWindow.mockReturnValueOnce(olderDeferred.promise);

    const callsBefore = GetReceivedMessageWindow.mock.calls.length;
    const p1 = store.loadOlderWindow();
    const p2 = store.loadOlderWindow();

    expect(GetReceivedMessageWindow.mock.calls.length).toBe(callsBefore + 1);
    expect(get(store).isLoadingWindow).toBe("older");

    olderDeferred.resolve(makeMessages(1, HISTORY_WINDOW_SIZE));
    await Promise.all([p1, p2]);

    expect(get(store).isLoadingWindow).toBeNull();

    unsub();
  });
});

describe("staleness guard", () => {
  it("ignores a stale loadOlderWindow result after selecting a different topic", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");

    const olderDeferred = deferred<mqtt.MqttMessage[]>();
    GetReceivedMessageWindow.mockReturnValueOnce(olderDeferred.promise);
    const olderPromise = store.loadOlderWindow();

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(1, 5, "other/topic")
    );
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("other/topic");

    olderDeferred.resolve(makeMessages(1, HISTORY_WINDOW_SIZE));
    await olderPromise;

    const s = get(store);
    expect(s.selectedTopic).toBe("other/topic");
    expect(s.history).toHaveLength(5);
    expect(s.history.every((m) => m.topic === "other/topic")).toBe(true);
    expect(s.isLoadingWindow).toBeNull();

    unsub();
  });
});

describe("jumpToLatest", () => {
  it("invalidates an in-flight older load and replaces history wholesale", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");
    const revisionBefore = get(store).historyRevision;

    const olderDeferred = deferred<mqtt.MqttMessage[]>();
    GetReceivedMessageWindow.mockReturnValueOnce(olderDeferred.promise);
    const olderPromise = store.loadOlderWindow();

    GetReceivedMessageWindow.mockResolvedValueOnce(
      makeMessages(15001, HISTORY_WINDOW_SIZE)
    );
    const jumpPromise = store.jumpToLatest();

    olderDeferred.resolve(makeMessages(1, HISTORY_WINDOW_SIZE));
    await Promise.all([olderPromise, jumpPromise]);

    const s = get(store);
    expect(s.history).toHaveLength(HISTORY_WINDOW_SIZE);
    expect(s.history[0].id).toBe("15001");
    expect(s.history[s.history.length - 1].id).toBe("20000");
    expect(s.historyRevision).toBeGreaterThan(revisionBefore);

    unsub();
  });
});
