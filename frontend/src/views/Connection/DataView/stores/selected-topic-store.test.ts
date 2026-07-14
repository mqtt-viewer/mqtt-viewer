import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

const listeners = new Map<string, (e: { data: unknown }) => void>();

vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: vi.fn((event: string, cb: (e: { data: unknown }) => void) => {
      listeners.set(event, cb);
      return () => listeners.delete(event);
    }),
  },
}));

const mockGetMessageHistory = vi.fn();
const mockGetAppSettings = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetMessageHistory: (...args: unknown[]) => mockGetMessageHistory(...args),
  GetAppSettings: (...args: unknown[]) => mockGetAppSettings(...args),
  GetReceivedMessageWindow: vi.fn().mockResolvedValue([]),
  GetReceivedMessageCount: vi.fn().mockResolvedValue(0),
}));

import {
  createSelectedTopicStore,
  MAX_LOADED_MESSAGES,
  TRIM_SLACK,
} from "./selected-topic-store";

const eventSet = {
  mqttMessages: "mqtt:messages",
  mqttClearHistory: "mqtt:clear",
} as any;

const makeMessage = (i: number) => ({
  id: `${i}`,
  topic: "a/b",
  payload: btoa(`payload-${i}`),
  timeMs: i,
  retain: false,
});

const makeStore = () => {
  const store = createSelectedTopicStore(1, eventSet);
  // The message listener registers on first subscription.
  const unsubscribe = store.subscribe(() => {});
  return { store, unsubscribe };
};

beforeEach(() => {
  listeners.clear();
  mockGetAppSettings.mockResolvedValue({ recordingEnabled: false });
  mockGetMessageHistory.mockResolvedValue([]);
});

describe("selected-topic-store memory-mode bounds", () => {
  it("caps the initial memory-mode fetch to the newest MAX_LOADED_MESSAGES", async () => {
    const total = MAX_LOADED_MESSAGES + 2000;
    mockGetMessageHistory.mockResolvedValue(
      Array.from({ length: total }, (_, i) => makeMessage(i))
    );
    const { store, unsubscribe } = makeStore();
    await store.selectTopic("a/b");

    const state = get(store);
    expect(state.history.length).toBe(MAX_LOADED_MESSAGES);
    // Newest kept, oldest dropped.
    expect(state.history[state.history.length - 1].id).toBe(`${total - 1}`);
    expect(state.history[0].id).toBe(`${total - MAX_LOADED_MESSAGES}`);
    // The count still reflects everything the backend holds.
    expect(state.totalCount).toBe(total);
    unsubscribe();
  });

  it("evicts oldest entries once live appends exceed the cap plus slack", async () => {
    const { store, unsubscribe } = makeStore();
    await store.selectTopic("a/b");
    const emit = listeners.get(eventSet.mqttMessages)!;

    const batch = 100;
    const batches = Math.ceil((MAX_LOADED_MESSAGES + TRIM_SLACK) / batch) + 5;
    for (let b = 0; b < batches; b++) {
      emit({
        data: Array.from({ length: batch }, (_, i) =>
          makeMessage(b * batch + i)
        ),
      });
    }

    const total = batches * batch;
    const state = get(store);
    expect(state.history.length).toBeLessThanOrEqual(
      MAX_LOADED_MESSAGES + TRIM_SLACK
    );
    // Newest survive, oldest evicted.
    expect(state.history[state.history.length - 1].id).toBe(`${total - 1}`);
    expect(Number(state.history[0].id)).toBeGreaterThan(0);
    // totalCount keeps counting past the cap.
    expect(state.totalCount).toBe(total);
    unsubscribe();
  });

  it("leaves history under the cap untouched", async () => {
    const { store, unsubscribe } = makeStore();
    await store.selectTopic("a/b");
    const emit = listeners.get(eventSet.mqttMessages)!;

    emit({ data: [makeMessage(0), makeMessage(1)] });
    const state = get(store);
    expect(state.history.length).toBe(2);
    expect(state.history[0].payload).toBe("payload-0");
    unsubscribe();
  });
});
