import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import type * as events from "bindings/mqtt-viewer/events/models";
import {
  createSelectedTopicStore,
  HISTORY_WINDOW_SIZE,
  MAX_LOADED_MESSAGES,
  TRIM_SLACK,
  PREFETCH_RADIUS,
  PAYLOAD_RETRY_DELAY_MS,
  type HistoryDelta,
} from "./selected-topic-store";

const GetMessageTimeline = vi.fn();
const GetMessageById = vi.fn();
const GetMessagesByIds = vi.fn();
const GetMessageHistory = vi.fn();
const GetReceivedTimelineWindow = vi.fn();
const GetReceivedMessageWindow = vi.fn();
const GetReceivedMessageById = vi.fn();
const GetReceivedMessagesByIds = vi.fn();
const GetReceivedMessageCount = vi.fn();
const GetAppSettings = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetMessageTimeline: (...args: unknown[]) => GetMessageTimeline(...args),
  GetMessageById: (...args: unknown[]) => GetMessageById(...args),
  GetMessagesByIds: (...args: unknown[]) => GetMessagesByIds(...args),
  GetMessageHistory: (...args: unknown[]) => GetMessageHistory(...args),
  GetReceivedTimelineWindow: (...args: unknown[]) =>
    GetReceivedTimelineWindow(...args),
  GetReceivedMessageWindow: (...args: unknown[]) =>
    GetReceivedMessageWindow(...args),
  GetReceivedMessageById: (...args: unknown[]) =>
    GetReceivedMessageById(...args),
  GetReceivedMessagesByIds: (...args: unknown[]) =>
    GetReceivedMessagesByIds(...args),
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

// Fires one batched event carrying many live messages, matching how the
// backend drains a busy topic (~600 messages per 300ms event).
const fireLiveMessageBatch = (messages: Partial<mqtt.MqttMessage>[]) => {
  const handler = listeners.get(connectionEventSet.mqttMessages);
  if (!handler) throw new Error("no mqttMessages listener registered");
  handler({ data: messages });
};

const makeLiveMessages = (startId: number, count: number, topic = "a/b") =>
  Array.from({ length: count }, (_, i) => ({
    id: `live-${startId + i}`,
    topic,
    payload: btoa("payload-live"),
    timeMs: 999_000_000 + startId + i,
    retain: false,
  }));

// Manually resolvable (or rejectable) promise, for controlling fetch timing
// in tests.
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Drains the microtask queue far enough for a fire-and-forget ensurePayload
// batch (mock resolution + withTimeout hop + store update) to fully settle.
const flushMicrotasks = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  GetAppSettings.mockResolvedValue({ recordingEnabled: true });
  // Safe default: every recording-enabled selectTopic now loads the in-RAM
  // session history via GetMessageTimeline; disk mode is opt-in via
  // loadRecordedHistory.
  GetMessageTimeline.mockResolvedValue([]);
  // Defaults: ensurePayload's auto-fetch (fired at the end of selectTopic/
  // jumpToLatest/loadRecordedHistory) resolves to something innocuous unless
  // a test overrides it. The single-message bindings report found=true, and
  // the batch bindings echo every requested id back, so nothing gets marked
  // aged-out by accident.
  GetReceivedMessageById.mockImplementation(
    async (_connId: number, topic: string, id: number) => [
      { id: String(id), topic, payload: btoa("auto"), timeMs: 0, retain: false },
      true,
    ]
  );
  GetMessageById.mockImplementation(
    async (_connId: number, topic: string, id: string, _timeMs: number) => [
      { id, topic, payload: btoa("auto"), timeMs: 0, retain: false },
      true,
    ]
  );
  GetReceivedMessagesByIds.mockImplementation(
    async (_connId: number, topic: string, ids: number[]) =>
      ids.map((id) => ({
        id: String(id),
        topic,
        payload: btoa("auto"),
        timeMs: id * 1000,
        retain: false,
      }))
  );
  GetMessagesByIds.mockImplementation(
    async (_connId: number, topic: string, ids: string[], timesMs: number[]) =>
      ids.map((id, i) => ({
        id,
        topic,
        payload: btoa("auto"),
        timeMs: timesMs[i],
        retain: false,
      }))
  );
});

describe("selectTopic (recording enabled)", () => {
  it("stays in memory mode and does not touch disk on selection", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, 10));
    GetReceivedMessageCount.mockResolvedValue(1234);

    await store.selectTopic("a/b");

    expect(GetReceivedTimelineWindow).not.toHaveBeenCalled();
    expect(GetMessageTimeline).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      HISTORY_WINDOW_SIZE
    );

    const s = get(store);
    expect(s.historySource).toBe("memory");
    expect(s.window).toBeNull();
    expect(s.history).toHaveLength(10);
    expect(s.recordingEnabled).toBe(true);

    unsub();
  });

  it("fetches the recorded count asynchronously without a loading state", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, 10));
    GetReceivedMessageCount.mockResolvedValue(1234);

    await store.selectTopic("a/b");
    // The count fetch is fire-and-forget; flush microtasks so it lands.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(GetReceivedMessageCount).toHaveBeenCalledWith(CONNECTION_ID, "a/b");
    expect(get(store).recordedCount).toBe(1234);
    expect(get(store).isLoadingHistory).toBe(false);

    unsub();
  });

  it("leaves recordedCount null when recording is disabled", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, 10));

    await store.selectTopic("a/b");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const s = get(store);
    expect(s.recordedCount).toBeNull();
    expect(s.recordingEnabled).toBe(false);
    expect(GetReceivedMessageCount).not.toHaveBeenCalled();

    unsub();
  });
});

describe("loadRecordedHistory", () => {
  it("loads a stub window (no payloads) and sets history/window/count", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const stubs = makeStubs(1, 10);
    GetReceivedTimelineWindow.mockResolvedValue(stubs);
    GetReceivedMessageCount.mockResolvedValue(10);

    await store.selectTopic("a/b");
    const revisionAfterSelect = get(store).historyRevision;

    await store.loadRecordedHistory();

    expect(GetReceivedTimelineWindow).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      0,
      0,
      HISTORY_WINDOW_SIZE
    );

    const s = get(store);
    expect(s.historySource).toBe("disk");
    expect(s.history).toHaveLength(10);
    // Stubs carry no payload bytes across the bridge. The auto-select of the
    // newest message has already kicked off its prefetch batch (so the state
    // is "loading", not "unfetched"), but nothing has landed yet.
    expect(s.history[0].payload).toBeNull();
    expect(s.history[0].payloadB64).toBeNull();
    expect(s.history[0].payloadState).toBe("loading");
    expect(s.window).toEqual({
      oldestId: 1,
      newestId: 10,
      isNewest: true,
      atOldest: true,
      newestMs: 10000,
    });
    expect(s.totalCount).toBe(10);
    expect(s.recordedCount).toBe(10);
    expect(s.isLoadingHistory).toBe(false);
    expect(s.historyRevision).toBeGreaterThan(revisionAfterSelect);

    unsub();
  });

  it("marks atOldest false when the window is full", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const stubs = makeStubs(7001, HISTORY_WINDOW_SIZE);
    GetReceivedTimelineWindow.mockResolvedValue(stubs);
    GetReceivedMessageCount.mockResolvedValue(12000);

    await store.selectTopic("a/b");
    await store.loadRecordedHistory();

    const s = get(store);
    expect(s.history).toHaveLength(HISTORY_WINDOW_SIZE);
    expect(s.window?.atOldest).toBe(false);
    expect(s.totalCount).toBe(12000);
    expect(s.recordedCount).toBe(12000);

    unsub();
  });

  it("prefetches the newest stub and its neighbours in ONE batch call after the stub window lands", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 10));
    GetReceivedMessageCount.mockResolvedValue(10);

    // The memory-mode select lands an empty history (GetMessageTimeline
    // defaults to []), so no memory-mode ensurePayload muddies call counts.
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    // ensurePayload for the newest stub is fired-and-forgotten at the end of
    // loadRecordedHistory; flush microtasks so it lands.
    await flushMicrotasks();

    // All 10 stubs sit inside the prefetch radius of the newest, so exactly
    // one batch call covers them, with numeric disk ids.
    expect(GetReceivedMessagesByIds).toHaveBeenCalledTimes(1);
    expect(GetReceivedMessagesByIds).toHaveBeenCalledWith(
      CONNECTION_ID,
      "a/b",
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );
    expect(GetReceivedMessageById).not.toHaveBeenCalled();

    const s = get(store);
    expect(s.history[9].payload).toBe("auto");
    expect(s.history[9].payloadState).toBe("loaded");
    expect(s.history[0].payloadState).toBe("loaded");

    unsub();
  });

  it("no-ops when nothing is selected", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    await store.loadRecordedHistory();

    expect(GetReceivedTimelineWindow).not.toHaveBeenCalled();

    unsub();
  });

  it("no-ops when already in disk mode", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 10));
    GetReceivedMessageCount.mockResolvedValue(10);

    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    // Let the auto-fetch of the newest stub settle so the state snapshot
    // below is stable across the second call.
    await flushMicrotasks();

    const callsBefore = GetReceivedTimelineWindow.mock.calls.length;
    const stateBefore = get(store);

    await store.loadRecordedHistory();

    expect(GetReceivedTimelineWindow.mock.calls.length).toBe(callsBefore);
    expect(get(store)).toEqual(stateBefore);

    unsub();
  });

  it("discards a stale result when another topic is selected while in flight", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce(makeStubs(1, 4));
    await store.selectTopic("a/b");

    const inFlight = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(inFlight.promise);
    GetReceivedMessageCount.mockResolvedValue(9999);
    const p = store.loadRecordedHistory();

    // User selects a different topic while the disk window is in flight.
    GetMessageTimeline.mockResolvedValueOnce(makeStubs(1, 3));
    await store.selectTopic("other/topic");

    inFlight.resolve(makeStubs(1, HISTORY_WINDOW_SIZE));
    await p;

    const s = get(store);
    expect(s.selectedTopic).toBe("other/topic");
    expect(s.historySource).toBe("memory");
    expect(s.history).toHaveLength(3);
    expect(s.isLoadingHistory).toBe(false);
    expect(s.totalCount).toBe(3);

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

  // At very high topic cardinality the backend trims its last-value cache, so
  // a topic still listed in the tree can have no history left and the
  // timeline binding rejects with "topic not found in message history".
  // Selecting it must show an empty, non-loading timeline, not fail.
  it("selects a topic with no retained history as an empty timeline", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    GetMessageTimeline.mockRejectedValue(
      new Error("topic not found in message history")
    );
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    await expect(store.selectTopic("dropped/topic")).resolves.toBeUndefined();

    const s = get(store);
    expect(s.selectedTopic).toBe("dropped/topic");
    expect(s.history).toEqual([]);
    expect(s.totalCount).toBe(0);
    expect(s.historySource).toBe("memory");
    expect(s.isLoadingHistory).toBe(false);
    // "Not found" is the expected case, so nothing is logged.
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    unsub();
  });

  it("logs an unexpected timeline fetch failure but still clears the loading state", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    GetMessageTimeline.mockRejectedValue(new Error("bridge exploded"));
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    await store.selectTopic("a/b");

    const s = get(store);
    expect(s.history).toEqual([]);
    expect(s.isLoadingHistory).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    unsub();
  });

  it("still appends live messages to a topic selected with no history", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    GetMessageTimeline.mockRejectedValue(new Error("topic not found"));
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});
    await store.selectTopic("dropped/topic");

    fireLiveMessage({
      id: "live-1",
      topic: "dropped/topic",
      payload: btoa("hi"),
      timeMs: 999999,
      retain: false,
    });

    const s = get(store);
    expect(s.history).toHaveLength(1);
    expect(s.history[0].id).toBe("live-1");
    expect(s.totalCount).toBe(1);

    unsub();
  });

  it("lets live appends overshoot the cap by up to TRIM_SLACK without trimming", async () => {
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

    // One past the cap sits inside the amortization slack: no trim yet.
    const s = get(store);
    expect(s.history).toHaveLength(MAX_LOADED_MESSAGES + 1);
    expect(s.history[s.history.length - 1].id).toBe("live-1");
    expect(s.history[0].id).toBe("1");
    expect(deltas.some((d) => d.kind === "trim")).toBe(false);

    unsub();
  });

  it("trims back down to MAX_LOADED_MESSAGES once past MAX + TRIM_SLACK", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, MAX_LOADED_MESSAGES));
    await store.selectTopic("a/b");

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    // MAX + TRIM_SLACK exactly: still inside the slack, no trim.
    fireLiveMessageBatch(makeLiveMessages(1, TRIM_SLACK));
    expect(get(store).history).toHaveLength(MAX_LOADED_MESSAGES + TRIM_SLACK);
    expect(deltas.some((d) => d.kind === "trim")).toBe(false);

    // One more crosses the threshold: trim down to exactly the cap,
    // evicting the oldest TRIM_SLACK + 1 messages.
    fireLiveMessage({
      id: "live-final",
      topic: "a/b",
      payload: btoa("payload-live"),
      timeMs: 999999999,
      retain: false,
    });

    const s = get(store);
    expect(s.history).toHaveLength(MAX_LOADED_MESSAGES);
    expect(s.history[s.history.length - 1].id).toBe("live-final");
    expect(s.history[0].id).toBe(String(TRIM_SLACK + 2));

    const trim = deltas.find((d) => d.kind === "trim");
    expect(trim).toBeDefined();
    if (trim?.kind === "trim") {
      expect(trim.ids).toHaveLength(TRIM_SLACK + 1);
      expect(trim.ids[0]).toBe("1");
      expect(trim.ids[trim.ids.length - 1]).toBe(String(TRIM_SLACK + 1));
    }

    unsub();
  });
});

describe("ensurePayload", () => {
  it("fetches and decodes a lone stub in disk mode via the single-message binding", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    // A one-stub window: the auto-fetch batch has size 1, which must use the
    // single-message binding rather than the batch one.
    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(2, 1));
    GetReceivedMessageCount.mockResolvedValue(1);
    GetReceivedMessageById.mockResolvedValueOnce([
      { id: "2", topic: "a/b", payload: btoa("hello"), timeMs: 2000, retain: true },
      true,
    ]);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    await flushMicrotasks();

    expect(GetReceivedMessageById).toHaveBeenCalledWith(CONNECTION_ID, "a/b", 2);
    expect(GetReceivedMessagesByIds).not.toHaveBeenCalled();
    const s = get(store);
    const msg = s.history.find((m) => m.id === "2");
    expect(msg?.payload).toBe("hello");
    expect(msg?.payloadState).toBe("loaded");
    expect(msg?.retain).toBe(true);

    unsub();
  });

  it("fetches a lone stub in memory mode via GetMessageById with the timeMs hint", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(3, 1));
    GetMessageById.mockResolvedValueOnce([
      { id: "3", topic: "a/b", payload: btoa("mem-hello"), timeMs: 3000, retain: false },
      true,
    ]);
    await store.selectTopic("a/b");
    await flushMicrotasks();

    // The hint is the stub's own timeMs, letting the backend binary-search
    // its window instead of scanning it.
    expect(GetMessageById).toHaveBeenCalledWith(CONNECTION_ID, "a/b", "3", 3000);
    expect(GetMessagesByIds).not.toHaveBeenCalled();
    const s = get(store);
    const msg = s.history.find((m) => m.id === "3");
    expect(msg?.payload).toBe("mem-hello");
    expect(msg?.payloadState).toBe("loaded");

    unsub();
  });

  it("decodes a live-appended message locally, without a backend fetch", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    await Promise.resolve();
    await Promise.resolve();

    fireLiveMessage({
      id: "live-1",
      topic: "a/b",
      payload: btoa("live-hello"),
      timeMs: 999999,
      retain: false,
    });

    // The live stub carries payloadB64, so ensurePayload must resolve it
    // synchronously in the frontend, never across the bridge.
    const backendCalls = () =>
      GetReceivedMessageById.mock.calls.length + GetMessageById.mock.calls.length;
    const callsBefore = backendCalls();
    await store.ensurePayload("live-1");
    expect(backendCalls()).toBe(callsBefore);

    const msg = get(store).history.find((m) => m.id === "live-1");
    expect(msg?.payload).toBe("live-hello");
    expect(msg?.payloadB64).toBe(btoa("live-hello"));
    expect(msg?.payloadState).toBe("loaded");

    unsub();
  });

  it("is a no-op (no extra fetch) when the payload is already loaded", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(2, 1));
    GetReceivedMessageCount.mockResolvedValue(1);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    await flushMicrotasks();

    const callsForId2 = () =>
      GetReceivedMessageById.mock.calls.filter((c) => c[2] === 2).length;
    expect(callsForId2()).toBe(1);
    expect(get(store).history[0].payloadState).toBe("loaded");

    // Explicit call for the same, now-loaded id must not re-fetch.
    await store.ensurePayload("2");
    expect(callsForId2()).toBe(1);
    expect(GetReceivedMessagesByIds).not.toHaveBeenCalled();

    unsub();
  });

  it("marks the stub aged-out when the backend reports not found", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(2, 1));
    GetReceivedMessageCount.mockResolvedValue(1);
    GetReceivedMessageById.mockResolvedValueOnce([
      { id: "", topic: "", payload: "", timeMs: 0, retain: false },
      false,
    ]);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    await flushMicrotasks();

    const s = get(store);
    const msg = s.history.find((m) => m.id === "2");
    expect(msg?.payloadState).toBe("aged-out");
    expect(msg?.payload).toBeNull();

    unsub();
  });

  it("reverts to unfetched and retries once when the fetch rejects", async () => {
    vi.useFakeTimers();
    try {
      const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
      const unsub = store.subscribe(() => {});

      GetReceivedTimelineWindow.mockResolvedValue(makeStubs(2, 1));
      GetReceivedMessageCount.mockResolvedValue(1);
      GetReceivedMessageById.mockRejectedValueOnce(new Error("boom"));
      await store.selectTopic("a/b");
      await store.loadRecordedHistory();
      await flushMicrotasks();

      // A transport error is not definitive: never "aged-out", back to
      // "unfetched" so it stays retryable.
      let msg = get(store).history.find((m) => m.id === "2");
      expect(msg?.payloadState).toBe("unfetched");

      // Exactly one automatic retry fires after the delay; the default mock
      // then reports found, so the payload lands without user action.
      await vi.advanceTimersByTimeAsync(PAYLOAD_RETRY_DELAY_MS);
      await flushMicrotasks();
      expect(
        GetReceivedMessageById.mock.calls.filter((c) => c[2] === 2).length
      ).toBe(2);
      msg = get(store).history.find((m) => m.id === "2");
      expect(msg?.payloadState).toBe("loaded");

      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it("no-ops for an id not present in history", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValue(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
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
    await store.loadRecordedHistory();
    await Promise.resolve();
    await Promise.resolve();

    const inFlight = deferred<[mqtt.MqttMessage, boolean]>();
    GetReceivedMessageById.mockReturnValueOnce(inFlight.promise);
    const ensurePromise = store.ensurePayload("2");

    // User selects a different topic while the fetch for "2" is in flight.
    // The new selection lands in memory mode (selectTopic never loads disk).
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
    await store.loadRecordedHistory();

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
    await store.loadRecordedHistory();

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
    await store.loadRecordedHistory();
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

    // loadRecordedHistory: newest window is ids 15001..20000.
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(15001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(30000);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();

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
    await store.loadRecordedHistory();

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
    // Live appends stay undecoded (base64 kept on payloadB64) until viewed;
    // ensurePayload decodes locally from payloadB64 on selection.
    expect(s.history[s.history.length - 1].payload).toBeNull();
    expect(s.history[s.history.length - 1].payloadB64).toBe(
      btoa("payload-live")
    );
    expect(s.history[s.history.length - 1].payloadState).toBe("unfetched");
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
    await store.loadRecordedHistory();

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
    await store.loadRecordedHistory();

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
    await store.loadRecordedHistory();

    const olderDeferred = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(olderDeferred.promise);
    const olderPromise = store.loadOlderWindow();

    // The new selection lands in memory mode (selectTopic never loads disk).
    GetMessageTimeline.mockResolvedValueOnce(makeStubs(1, 5));
    await store.selectTopic("other/topic");

    olderDeferred.resolve(makeStubs(1, HISTORY_WINDOW_SIZE));
    await olderPromise;

    const s = get(store);
    expect(s.selectedTopic).toBe("other/topic");
    expect(s.historySource).toBe("memory");
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
    await store.loadRecordedHistory();
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

  it("holds live messages during the fetch and merges only those newer than the fetched window", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([]);
    await store.selectTopic("a/b");
    GetReceivedMessageCount.mockResolvedValueOnce(1);
    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 1));
    await store.loadRecordedHistory();
    expect(get(store).window?.isNewest).toBe(true);

    const win = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const jumping = store.jumpToLatest();
    await flushMicrotasks();
    // A jump holds without the panel's loading state (see the next test).
    expect(get(store).isLoadingHistory).toBe(false);

    // "uuid-1" is row 1 under its live id (same millisecond, already on
    // disk); "uuid-2" arrived after the read ran and is on no row yet.
    fireLiveMessageBatch([
      { id: "uuid-1", topic: "a/b", payload: btoa("1"), timeMs: 1000, retain: false },
      { id: "uuid-2", topic: "a/b", payload: btoa("2"), timeMs: 2000, retain: false },
    ]);
    // Held, not appended: the landing fetch would discard an append.
    expect(get(store).history.map((m) => m.id)).toEqual(["1"]);

    win.resolve(makeStubs(1, 1));
    await jumping;

    const s = get(store);
    expect(s.isLoadingHistory).toBe(false);
    expect(s.history.map((m) => m.id)).toEqual(["1", "uuid-2"]);
    expect(s.window?.isNewest).toBe(true);
    expect(s.window?.newestId).toBe(1);

    unsub();
  });

  it("clears the loading state and keeps held live messages when the fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([]);
    await store.selectTopic("a/b");
    GetReceivedMessageCount.mockResolvedValueOnce(1);
    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 1));
    await store.loadRecordedHistory();
    const rev0 = get(store).historyRevision;

    const win = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const jumping = store.jumpToLatest();
    await flushMicrotasks();
    fireLiveMessageBatch([
      { id: "uuid-2", topic: "a/b", payload: btoa("2"), timeMs: 2000, retain: false },
    ]);

    win.reject(new Error("boom"));
    await expect(jumping).resolves.toBeUndefined();

    const s = get(store);
    expect(s.isLoadingHistory).toBe(false);
    expect(s.history.map((m) => m.id)).toEqual(["1", "uuid-2"]);
    expect(s.totalCount).toBe(2);
    expect(s.historyRevision).toBe(rev0 + 1);
    expect(s.window?.isNewest).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    unsub();
  });

  it("holds live messages during a jump without entering the loading state", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([]);
    await store.selectTopic("a/b");
    GetReceivedMessageCount.mockResolvedValueOnce(1);
    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 1));
    await store.loadRecordedHistory();

    const win = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const jumping = store.jumpToLatest();
    await flushMicrotasks();
    // The panel unmounts the timeline while isLoadingHistory is set, which
    // a jump must not do: the hold is keyed to the request token instead.
    expect(get(store).isLoadingHistory).toBe(false);

    fireLiveMessageBatch([
      { id: "uuid-2", topic: "a/b", payload: btoa("2"), timeMs: 2000, retain: false },
    ]);
    // Still held, still not loading.
    expect(get(store).history.map((m) => m.id)).toEqual(["1"]);
    expect(get(store).isLoadingHistory).toBe(false);

    win.resolve(makeStubs(1, 1));
    await jumping;

    const s = get(store);
    expect(s.isLoadingHistory).toBe(false);
    expect(s.history.map((m) => m.id)).toEqual(["1", "uuid-2"]);
    expect(s.totalCount).toBe(2);

    unsub();
  });

  it("holds live messages during a jump started from an older window", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    // Reach a non-newest window the way the cap eviction test does: page
    // back far enough that the newest end is evicted.
    GetMessageTimeline.mockResolvedValueOnce([]);
    GetReceivedMessageCount.mockResolvedValue(30000);
    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(15001, HISTORY_WINDOW_SIZE)
    );
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    for (const start of [10001, 5001, 1, 1 - HISTORY_WINDOW_SIZE]) {
      GetReceivedTimelineWindow.mockResolvedValueOnce(
        makeStubs(start, HISTORY_WINDOW_SIZE)
      );
      await store.loadOlderWindow();
    }
    expect(get(store).window?.isNewest).toBe(false);

    const win = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const jumping = store.jumpToLatest();
    await flushMicrotasks();
    // Arrives during the jump: the frozen-window guard must not drop it,
    // it belongs to the newest window the jump lands on.
    fireLiveMessageBatch([
      { id: "uuid-new", topic: "a/b", payload: btoa("n"), timeMs: 30_000_001, retain: false },
    ]);
    expect(get(store).history.some((m) => m.id === "uuid-new")).toBe(false);

    win.resolve(makeStubs(29001, 1000));
    await jumping;

    const s = get(store);
    expect(s.window?.isNewest).toBe(true);
    expect(s.history[s.history.length - 1].id).toBe("uuid-new");
    expect(s.history.filter((m) => m.id === "uuid-new")).toHaveLength(1);

    unsub();
  });

  it("clears the older/newer single-flight guard when the fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(
      makeStubs(5001, HISTORY_WINDOW_SIZE)
    );
    GetReceivedMessageCount.mockResolvedValue(20000);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();

    const olderDeferred = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(olderDeferred.promise);
    const olderPromise = store.loadOlderWindow();
    expect(get(store).isLoadingWindow).toBe("older");

    // The jump's token bump makes the older load land stale, and a stale
    // return never touches the guard, so the failed jump must clear it or
    // paging stays dead for this selection.
    GetReceivedTimelineWindow.mockRejectedValueOnce(new Error("boom"));
    await store.jumpToLatest();
    expect(get(store).isLoadingWindow).toBeNull();

    olderDeferred.resolve(makeStubs(1, HISTORY_WINDOW_SIZE));
    await olderPromise;

    const s = get(store);
    expect(s.isLoadingWindow).toBeNull();
    expect(s.history).toHaveLength(HISTORY_WINDOW_SIZE);
    expect(s.history[0].id).toBe("5001");
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    unsub();
  });

  it("feeds held messages into the chart cache too when the fetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([]);
    await store.selectTopic("a/b");
    GetReceivedMessageCount.mockResolvedValueOnce(1);
    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 1));
    await store.loadRecordedHistory();
    GetReceivedMessageWindow.mockResolvedValueOnce(makeMessages(1, 1));
    await store.ensureChartHistory();
    expect(get(store).chartHistory).toHaveLength(1);

    const win = deferred<any[]>();
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const jumping = store.jumpToLatest();
    await flushMicrotasks();
    fireLiveMessageBatch([
      { id: "uuid-2", topic: "a/b", payload: btoa("2"), timeMs: 2000, retain: false },
    ]);

    win.reject(new Error("boom"));
    await jumping;

    const s = get(store);
    expect(s.history.map((m) => m.id)).toEqual(["1", "uuid-2"]);
    expect(s.chartHistory!.map((m) => m.id)).toEqual(["1", "uuid-2"]);
    // The chart draws from decoded payloads, so the entry lands decoded.
    expect(s.chartHistory![1].payload).toBe("2");
    expect(s.chartHistory![1].payloadState).toBe("loaded");
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
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
    await store.loadRecordedHistory();

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

  it("appends fully-decoded live messages to a loaded chart cache", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    GetReceivedMessageWindow.mockResolvedValueOnce(makeMessages(1, 5));
    await store.ensureChartHistory();

    fireLiveMessage({
      id: "live-1",
      topic: "a/b",
      payload: btoa("chart-live"),
      timeMs: 999999,
      retain: false,
    });

    const s = get(store);
    // The chart cache gets the decoded payload (it draws from it directly),
    // while the main history keeps the cheap undecoded entry.
    expect(s.chartHistory).toHaveLength(6);
    expect(s.chartHistory?.[5].payload).toBe("chart-live");
    expect(s.chartHistory?.[5].payloadState).toBe("loaded");
    expect(s.history[s.history.length - 1].payload).toBeNull();
    expect(s.history[s.history.length - 1].payloadState).toBe("unfetched");

    unsub();
  });

  it("resets the chart cache on a new topic selection", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 5));
    GetReceivedMessageCount.mockResolvedValue(5);
    await store.selectTopic("a/b");
    await store.loadRecordedHistory();
    GetReceivedMessageWindow.mockResolvedValueOnce(makeMessages(1, 5));
    await store.ensureChartHistory();
    expect(get(store).chartHistory).not.toBeNull();

    // The second select lands in memory mode (GetMessageTimeline defaults to
    // []); its only job here is proving the chart cache resets.
    await store.selectTopic("other/topic");

    expect(get(store).chartHistory).toBeNull();

    unsub();
  });
});

// The backend appends a message to its in-RAM history the moment it arrives,
// but the batched mqttMessages event carrying it fires up to 300ms later. A
// timeline fetch issued inside that gap already contains the message, so the
// live event must not append it a second time (a duplicate id used to wedge
// the vis DataSet for good).
describe("live append dedupe against the fetched window", () => {
  it("does not append a live message that the timeline fetch already returned", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, 10));
    await store.selectTopic("a/b");

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    fireLiveMessage({
      id: "10",
      topic: "a/b",
      payload: btoa("payload-10"),
      timeMs: 10000,
      retain: false,
    });

    const s = get(store);
    expect(s.history).toHaveLength(10);
    expect(s.totalCount).toBe(10);
    expect(deltas).toHaveLength(0);

    unsub();
  });

  it("appends only the new messages when a live batch partly overlaps the fetched window", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, 10));
    await store.selectTopic("a/b");

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    fireLiveMessageBatch([
      { id: "9", topic: "a/b", payload: btoa("payload-9"), timeMs: 9000, retain: false },
      { id: "10", topic: "a/b", payload: btoa("payload-10"), timeMs: 10000, retain: false },
      {
        id: "live-11",
        topic: "a/b",
        payload: btoa("payload-live"),
        timeMs: 11000,
        retain: false,
      },
    ]);

    const s = get(store);
    expect(s.history).toHaveLength(11);
    expect(s.history[s.history.length - 1].id).toBe("live-11");
    expect(s.totalCount).toBe(11);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].kind).toBe("append");
    if (deltas[0].kind === "append") {
      expect(deltas[0].messages.map((m) => m.id)).toEqual(["live-11"]);
    }

    unsub();
  });

  it("holds live messages that arrive while the timeline fetch is in flight and applies them once it lands, minus duplicates", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const inFlight = deferred<any[]>();
    GetMessageTimeline.mockReturnValueOnce(inFlight.promise);
    const selecting = store.selectTopic("a/b");
    // Past the GetAppSettings await, now parked on GetMessageTimeline.
    await flushMicrotasks();
    expect(get(store).isLoadingHistory).toBe(true);

    // "10" is also in the window the fetch is about to return; "live-11" is
    // genuinely new and exists in neither the fetch nor any later event.
    fireLiveMessageBatch([
      { id: "10", topic: "a/b", payload: btoa("payload-10"), timeMs: 10000, retain: false },
      {
        id: "live-11",
        topic: "a/b",
        payload: btoa("payload-live"),
        timeMs: 11000,
        retain: false,
      },
    ]);
    // Nothing is applied while the fetch is outstanding.
    expect(get(store).history).toHaveLength(0);

    inFlight.resolve(makeStubs(1, 10));
    await selecting;

    const s = get(store);
    const ids = s.history.map((m) => m.id);
    expect(ids).toEqual([...makeStubs(1, 10).map((st) => st.id), "live-11"]);
    expect(s.totalCount).toBe(11);
    expect(s.isLoadingHistory).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);

    unsub();
  });

  it("discards messages held during a fetch when the selection changes before it lands", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const inFlight = deferred<any[]>();
    GetMessageTimeline.mockReturnValueOnce(inFlight.promise);
    const selectingAB = store.selectTopic("a/b");
    await flushMicrotasks();
    fireLiveMessageBatch(makeLiveMessages(1, 3, "a/b"));

    // User moves on before the a/b fetch lands.
    GetMessageTimeline.mockResolvedValueOnce(makeStubs(20, 3));
    await store.selectTopic("c/d");

    inFlight.resolve(makeStubs(1, 10));
    await selectingAB;

    const s = get(store);
    expect(s.selectedTopic).toBe("c/d");
    expect(s.history.map((m) => m.id)).toEqual(["20", "21", "22"]);
    expect(s.totalCount).toBe(3);
    expect(s.history.some((m) => m.id.startsWith("live-"))).toBe(false);

    unsub();
  });
  it("does not push a live message into the chart cache when the chart fetch already returned it", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValue(makeStubs(1, 10));
    await store.selectTopic("a/b");

    // Message 11 reached the backend between the timeline fetch and the
    // chart fetch and has not been emitted yet, so the chart cache is one
    // message ahead of the stub history.
    GetMessageHistory.mockResolvedValue(makeMessages(1, 11));
    await store.ensureChartHistory();
    expect(get(store).chartHistory).toHaveLength(11);

    fireLiveMessage({
      id: "11",
      topic: "a/b",
      payload: btoa("payload-11"),
      timeMs: 11000,
      retain: false,
    });

    const s = get(store);
    const expected = makeStubs(1, 11).map((st) => st.id);
    expect(s.history.map((m) => m.id)).toEqual(expected);
    expect(s.chartHistory!.map((m) => m.id)).toEqual(expected);

    unsub();
  });

  it("still drops a re-delivered id when a newer entry carries an older receive time", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    // The fetch already holds "dup" (received, not yet emitted).
    GetMessageTimeline.mockResolvedValue([
      ...makeStubs(1, 3),
      { id: "dup", timeMs: 10_500, qos: 0, retain: false },
    ]);
    await store.selectTopic("a/b");

    // A message whose receive clock stepped back five seconds lands first,
    // so the newest entry in history is now older than the dedupe cutoff.
    fireLiveMessage({
      id: "skew",
      topic: "a/b",
      payload: btoa("payload-skew"),
      timeMs: 5000,
      retain: false,
    });
    // Then the batch that re-delivers "dup".
    fireLiveMessageBatch([
      { id: "dup", topic: "a/b", payload: btoa("payload-dup"), timeMs: 10_500, retain: false },
      { id: "fresh", topic: "a/b", payload: btoa("payload-fresh"), timeMs: 10_600, retain: false },
    ]);

    const s = get(store);
    expect(s.history.map((m) => m.id)).toEqual(["1", "2", "3", "dup", "skew", "fresh"]);
    expect(s.totalCount).toBe(6);

    unsub();
  });
});

describe("live messages held during a load", () => {
  it("holds live messages during selectTopic when the previous selection was in disk mode", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce(makeStubs(1, 3));
    await store.selectTopic("a/b");
    GetReceivedMessageCount.mockResolvedValueOnce(3);
    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 3));
    await store.loadRecordedHistory();
    expect(get(store).historySource).toBe("disk");
    expect(get(store).window?.isNewest).toBe(true);

    // Select another topic; a batch for it lands while its fetch is in
    // flight. The listener's disk-mode guard must not swallow it: the new
    // selection is a memory view from the moment it opens.
    const inFlight = deferred<any[]>();
    GetMessageTimeline.mockReturnValueOnce(inFlight.promise);
    const selecting = store.selectTopic("c/d");
    await flushMicrotasks();
    expect(get(store).isLoadingHistory).toBe(true);
    fireLiveMessageBatch(makeLiveMessages(1, 1, "c/d"));

    inFlight.resolve(makeStubs(20, 2));
    await selecting;

    const s = get(store);
    expect(s.historySource).toBe("memory");
    expect(s.history.map((m) => m.id)).toEqual(["20", "21", "live-1"]);
    expect(s.totalCount).toBe(3);

    unsub();
  });

  it("holds only the selected topic's messages from a batch that spans topics", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const inFlight = deferred<any[]>();
    GetMessageTimeline.mockReturnValueOnce(inFlight.promise);
    const selecting = store.selectTopic("a/b");
    await flushMicrotasks();
    fireLiveMessageBatch([
      { id: "o1", topic: "other", payload: btoa("x"), timeMs: 1, retain: false },
      { id: "m1", topic: "a/b", payload: btoa("x"), timeMs: 2, retain: false },
      { id: "o2", topic: "other", payload: btoa("x"), timeMs: 3, retain: false },
    ]);

    inFlight.resolve([]);
    await selecting;

    expect(get(store).history.map((m) => m.id)).toEqual(["m1"]);

    unsub();
  });

  it("applies the memory cap to messages held while the timeline fetch was in flight", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const inFlight = deferred<any[]>();
    GetMessageTimeline.mockReturnValueOnce(inFlight.promise);
    const deltas: HistoryDelta[] = [];
    const selecting = store.selectTopic("a/b", (d) => deltas.push(d));
    await flushMicrotasks();

    // Enough held messages that fetched + held overshoots MAX + TRIM_SLACK.
    const heldCount = MAX_LOADED_MESSAGES + TRIM_SLACK + 1000;
    fireLiveMessageBatch(makeLiveMessages(1, heldCount, "a/b"));

    inFlight.resolve(makeStubs(1, 5000));
    await selecting;

    const s = get(store);
    expect(s.history).toHaveLength(MAX_LOADED_MESSAGES);
    // Trimmed from the oldest end: the fetched stubs and the oldest held
    // messages went, the newest held message is still last.
    const excess = 5000 + heldCount - MAX_LOADED_MESSAGES;
    expect(s.history[0].id).toBe(`live-${excess - 5000 + 1}`);
    expect(s.history[s.history.length - 1].id).toBe(`live-${heldCount}`);
    // The hold itself is bounded at MAX_LOADED_MESSAGES (see the listener),
    // so the oldest held messages never reached `history` and only the
    // fetched stubs are evicted, and reported, on landing.
    const trims = deltas.filter((d) => d.kind === "trim");
    expect(trims).toHaveLength(1);
    if (trims[0].kind === "trim") {
      expect(trims[0].ids).toHaveLength(5000);
      expect(trims[0].ids[0]).toBe("1");
      expect(trims[0].ids[trims[0].ids.length - 1]).toBe("5000");
    }

    unsub();
  });

  it("applies the memory cap to messages held while a not-found timeline fetch was in flight", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    let rejectFetch!: (e: unknown) => void;
    GetMessageTimeline.mockReturnValueOnce(
      new Promise((_, rej) => {
        rejectFetch = rej;
      })
    );
    const selecting = store.selectTopic("a/b");
    await flushMicrotasks();

    const heldCount = MAX_LOADED_MESSAGES + TRIM_SLACK + 1;
    fireLiveMessageBatch(makeLiveMessages(1, heldCount, "a/b"));

    rejectFetch(new Error("topic not found"));
    await selecting;

    const s = get(store);
    expect(s.history).toHaveLength(MAX_LOADED_MESSAGES);
    expect(s.history[s.history.length - 1].id).toBe(`live-${heldCount}`);

    unsub();
  });

  it("applies the memory cap to messages held while the recorded window was loading", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce(makeStubs(1, 3));
    await store.selectTopic("a/b");

    const win = deferred<any[]>();
    GetReceivedMessageCount.mockResolvedValueOnce(5000);
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const loading = store.loadRecordedHistory();
    await flushMicrotasks();
    expect(get(store).isLoadingHistory).toBe(true);

    const heldCount = MAX_LOADED_MESSAGES + TRIM_SLACK + 1;
    fireLiveMessageBatch(makeLiveMessages(1, heldCount, "a/b"));

    win.resolve(makeStubs(1, 5000));
    await loading;

    const s = get(store);
    expect(s.historySource).toBe("disk");
    expect(s.window?.isNewest).toBe(true);
    expect(s.history).toHaveLength(MAX_LOADED_MESSAGES);
    expect(s.history[s.history.length - 1].id).toBe(`live-${heldCount}`);

    unsub();
  });

  it("appends held messages, minus already-loaded ids, when the recorded window fetch fails", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce(makeStubs(1, 3));
    const deltas: HistoryDelta[] = [];
    await store.selectTopic("a/b", (d) => deltas.push(d));
    const rev0 = get(store).historyRevision;

    const win = deferred<any[]>();
    GetReceivedMessageCount.mockResolvedValueOnce(3);
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const loading = store.loadRecordedHistory();
    await flushMicrotasks();
    expect(get(store).isLoadingHistory).toBe(true);

    // "3" is already loaded; "live-x" is new.
    fireLiveMessageBatch([
      { id: "3", topic: "a/b", payload: btoa("payload-3"), timeMs: 3000, retain: false },
      { id: "live-x", topic: "a/b", payload: btoa("payload-live"), timeMs: 4000, retain: false },
    ]);
    expect(get(store).history).toHaveLength(3);

    win.reject(new Error("boom"));
    await loading;

    const s = get(store);
    expect(s.historySource).toBe("memory");
    expect(s.isLoadingHistory).toBe(false);
    expect(s.history.map((m) => m.id)).toEqual(["1", "2", "3", "live-x"]);
    expect(s.historyRevision).toBe(rev0 + 1);
    expect(s.totalCount).toBe(4);
    expect(deltas.filter((d) => d.kind === "append")).toHaveLength(0);

    unsub();
  });

  it("drops held live messages the recorded window already returned under their disk ids", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([
      { id: "uuid-1", timeMs: 1000, qos: 0, retain: false },
    ]);
    await store.selectTopic("a/b");

    // A disk row carries the numeric id SQLite gave it; the live copy of the
    // same message carries its UUID, so ids cannot match the two up. The
    // recorder writes in arrival order, so a held message not yet on disk
    // is newer than every row the read returned: only those survive.
    const win = deferred<any[]>();
    GetReceivedMessageCount.mockResolvedValueOnce(3);
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const loading = store.loadRecordedHistory();
    await flushMicrotasks();
    expect(get(store).isLoadingHistory).toBe(true);

    // "uuid-3" is row 3 (same millisecond, already recorded); "uuid-4"
    // arrived after the read and is not on disk yet.
    fireLiveMessageBatch([
      { id: "uuid-3", topic: "a/b", payload: btoa("3"), timeMs: 3000, retain: false },
      { id: "uuid-4", topic: "a/b", payload: btoa("4"), timeMs: 4000, retain: false },
    ]);

    win.resolve(makeStubs(1, 3));
    await loading;

    const s = get(store);
    expect(s.history.map((m) => m.id)).toEqual(["1", "2", "3", "uuid-4"]);
    expect(s.history.filter((m) => m.timeMs === 3000)).toHaveLength(1);
    expect(s.totalCount).toBe(4);
    expect(s.window?.newestId).toBe(3);

    unsub();
  });

  it("keeps every held live message when the recorded window is empty", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([]);
    await store.selectTopic("a/b");

    const win = deferred<any[]>();
    GetReceivedMessageCount.mockResolvedValueOnce(0);
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const loading = store.loadRecordedHistory();
    await flushMicrotasks();
    fireLiveMessageBatch([
      { id: "uuid-1", topic: "a/b", payload: btoa("1"), timeMs: 1000, retain: false },
      { id: "uuid-2", topic: "a/b", payload: btoa("2"), timeMs: 2000, retain: false },
    ]);

    win.resolve([]);
    await loading;

    const s = get(store);
    expect(s.historySource).toBe("disk");
    expect(s.history.map((m) => m.id)).toEqual(["uuid-1", "uuid-2"]);
    expect(s.totalCount).toBe(2);

    unsub();
  });

  it("feeds held messages into the chart cache too when the recorded window fetch fails", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([
      { id: "uuid-1", timeMs: 1000, qos: 0, retain: false },
    ]);
    await store.selectTopic("a/b");
    GetMessageHistory.mockResolvedValueOnce([
      { id: "uuid-1", topic: "a/b", payload: btoa("1"), timeMs: 1000, retain: false },
    ]);
    await store.ensureChartHistory();
    expect(get(store).chartHistory).toHaveLength(1);

    const win = deferred<any[]>();
    GetReceivedMessageCount.mockResolvedValueOnce(1);
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const loading = store.loadRecordedHistory();
    await flushMicrotasks();
    expect(get(store).isLoadingHistory).toBe(true);

    // "uuid-1" is already in both caches; "uuid-2" is new to both.
    fireLiveMessageBatch([
      { id: "uuid-1", topic: "a/b", payload: btoa("1"), timeMs: 1000, retain: false },
      { id: "uuid-2", topic: "a/b", payload: btoa("2"), timeMs: 2000, retain: false },
    ]);

    win.reject(new Error("disk unavailable"));
    await loading;

    const s = get(store);
    expect(s.historySource).toBe("memory");
    expect(s.isLoadingHistory).toBe(false);
    expect(s.history.map((m) => m.id)).toEqual(["uuid-1", "uuid-2"]);
    expect(s.chartHistory!.map((m) => m.id)).toEqual(["uuid-1", "uuid-2"]);
    // The chart draws from decoded payloads, so the entry lands decoded.
    expect(s.chartHistory![1].payload).toBe("2");
    expect(s.chartHistory![1].payloadState).toBe("loaded");

    unsub();
  });

  it("feeds held messages into a chart cache that loaded during the timeline fetch", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const inFlight = deferred<any[]>();
    GetMessageTimeline.mockReturnValueOnce(inFlight.promise);
    const selecting = store.selectTopic("a/b");
    await flushMicrotasks();
    expect(get(store).isLoadingHistory).toBe(true);

    // The Chart tab is visible, so it asks for the chart cache as soon as
    // the selection opens, and that fetch lands before the timeline's.
    GetMessageHistory.mockResolvedValueOnce(makeMessages(1, 3));
    await store.ensureChartHistory();
    expect(get(store).chartHistory).toHaveLength(3);

    fireLiveMessageBatch([
      { id: "live-4", topic: "a/b", payload: btoa("4"), timeMs: 4000, retain: false },
    ]);
    expect(get(store).history).toHaveLength(0);

    inFlight.resolve(makeStubs(1, 3));
    await selecting;

    const s = get(store);
    expect(s.history.map((m) => m.id)).toEqual(["1", "2", "3", "live-4"]);
    expect(s.chartHistory!.map((m) => m.id)).toEqual(["1", "2", "3", "live-4"]);
    expect(s.chartHistory![3].payload).toBe("4");
    expect(s.chartHistory![3].payloadState).toBe("loaded");

    unsub();
  });

  it("drops a held live copy of a fetched row when a later row carries an older receive time", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([]);
    await store.selectTopic("a/b");

    const win = deferred<any[]>();
    GetReceivedMessageCount.mockResolvedValueOnce(2);
    GetReceivedTimelineWindow.mockReturnValueOnce(win.promise);
    const loading = store.loadRecordedHistory();
    await flushMicrotasks();

    // "uuid-1" is row 1's live copy. The clock stepped back between rows 1
    // and 2, so the last fetched row is older than the first; a bound taken
    // from the last row alone would let the copy through.
    fireLiveMessageBatch([
      { id: "uuid-1", topic: "a/b", payload: btoa("1"), timeMs: 5000, retain: false },
    ]);

    win.resolve([
      { id: "1", timeMs: 5000, qos: 0, retain: false },
      { id: "2", timeMs: 3000, qos: 0, retain: false },
    ]);
    await loading;

    const s = get(store);
    expect(s.history.map((m) => m.id)).toEqual(["1", "2"]);
    expect(s.totalCount).toBe(2);
    expect(s.window?.newestMs).toBe(5000);

    unsub();
  });

  it("bounds the hold at MAX_LOADED_MESSAGES + TRIM_SLACK while the fetch hangs", async () => {
    GetAppSettings.mockResolvedValue({ recordingEnabled: false });
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const inFlight = deferred<any[]>();
    GetMessageTimeline.mockReturnValueOnce(inFlight.promise);
    const selecting = store.selectTopic("a/b");
    await flushMicrotasks();

    // Drains of 1000 while the fetch hangs. The drain that pushes the
    // holder past MAX + TRIM_SLACK must trim it back to MAX (dropping the
    // oldest TRIM_SLACK + 1000), and one more drain then lands on top. An
    // unbounded holder would be indistinguishable after enforceCap trimmed
    // the landed history to exactly MAX; a bounded one lands MAX + 1000
    // entries, under the landing trim threshold, so the length and the
    // first id together prove where the trim happened.
    const batch = 1000;
    const total = MAX_LOADED_MESSAGES + TRIM_SLACK + 2 * batch;
    for (let start = 1; start <= total; start += batch) {
      fireLiveMessageBatch(makeLiveMessages(start, batch, "a/b"));
    }
    expect(get(store).history).toHaveLength(0);

    inFlight.resolve([]);
    await selecting;

    const s = get(store);
    expect(s.history).toHaveLength(MAX_LOADED_MESSAGES + batch);
    expect(s.history[0].id).toBe(`live-${TRIM_SLACK + batch + 1}`);
    expect(s.history[s.history.length - 1].id).toBe(`live-${total}`);
    expect(s.totalCount).toBe(MAX_LOADED_MESSAGES + batch);

    unsub();
  });
});

// In disk mode a row and its live copy never share an id (numeric SQLite id
// against the receive-time UUID), so the listener's id dedupe cannot catch a
// live event for a row the window read already returned. Receive time can:
// the recorder writes in arrival order, so anything genuinely new is after
// the newest disk row in the window.
describe("disk-mode live dedupe against the loaded window", () => {
  it("lets an older-stamped live message through once the read's race window has passed", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([]);
    await store.selectTopic("a/b");
    GetReceivedMessageCount.mockResolvedValueOnce(3);
    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 3));
    await store.loadRecordedHistory();

    // A broker-host clock step backwards well after the window landed:
    // live messages now stamp before window.newestMs. The gate against
    // re-delivered rows only covers the drain that can trail the read, so
    // these must not be dropped.
    const realNow = Date.now;
    const later = realNow() + 5000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => later);
    try {
      fireLiveMessageBatch([
        { id: "uuid-old", topic: "a/b", payload: btoa("o"), timeMs: 2500, retain: false },
      ]);
    } finally {
      nowSpy.mockRestore();
    }

    const s = get(store);
    expect(s.history.map((m) => m.id)).toEqual(["1", "2", "3", "uuid-old"]);
    expect(s.window?.newestMs).toBe(3000);

    unsub();
  });

  it("drops a live copy of a row the window read already returned", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce([]);
    await store.selectTopic("a/b");
    GetReceivedMessageCount.mockResolvedValueOnce(3);
    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(1, 3));
    await store.loadRecordedHistory();
    expect(get(store).window?.newestMs).toBe(3000);

    const deltas: HistoryDelta[] = [];
    store.setOnHistoryDelta((d) => deltas.push(d));

    // Row 3's live event was processed after the response landed: same
    // message under its UUID, same millisecond. "uuid-4" arrived after the
    // read ran and is on no row yet.
    fireLiveMessageBatch([
      { id: "uuid-3", topic: "a/b", payload: btoa("3"), timeMs: 3000, retain: false },
      { id: "uuid-4", topic: "a/b", payload: btoa("4"), timeMs: 4000, retain: false },
    ]);

    const s = get(store);
    expect(s.history.map((m) => m.id)).toEqual(["1", "2", "3", "uuid-4"]);
    expect(s.totalCount).toBe(4);
    // Live UUID appends never move the disk-side bounds.
    expect(s.window?.newestId).toBe(3);
    expect(s.window?.newestMs).toBe(3000);
    expect(deltas).toHaveLength(1);
    if (deltas[0].kind === "append") {
      expect(deltas[0].messages.map((m) => m.id)).toEqual(["uuid-4"]);
    }

    unsub();
  });
});

describe("disk window cursor with live ids", () => {
  it("does not move the cursor for a live UUID that starts with digits", async () => {
    const store = createSelectedTopicStore(CONNECTION_ID, connectionEventSet);
    const unsub = store.subscribe(() => {});

    GetMessageTimeline.mockResolvedValueOnce(makeStubs(1, 3));
    await store.selectTopic("a/b");
    GetReceivedMessageCount.mockResolvedValueOnce(50);
    GetReceivedTimelineWindow.mockResolvedValueOnce(makeStubs(48, 3));
    await store.loadRecordedHistory();
    expect(get(store).window?.newestId).toBe(50);

    const uuid = "9876abcd-0000-4000-8000-000000000000";
    fireLiveMessage({
      id: uuid,
      topic: "a/b",
      payload: btoa("payload-live"),
      timeMs: 60_000,
      retain: false,
    });

    const s = get(store);
    expect(s.history.map((m) => m.id)).toEqual(["48", "49", "50", uuid]);
    expect(s.window?.newestId).toBe(50);

    unsub();
  });
});
