import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
  getHist: vi.fn(),
  getWindow: vi.fn(),
  getCount: vi.fn(),
  getSettings: vi.fn(),
  handlers: new Map<string, Set<(e: any) => void>>(),
}));

vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: (name: string, cb: (e: any) => void) => {
      const handlers = mocks.handlers.get(name) ?? new Set();
      handlers.add(cb);
      mocks.handlers.set(name, handlers);
      return () => mocks.handlers.get(name)?.delete(cb);
    },
  },
}));

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetMessageHistory: mocks.getHist,
  GetReceivedMessageWindow: mocks.getWindow,
  GetReceivedMessageCount: mocks.getCount,
  GetAppSettings: mocks.getSettings,
}));

import {
  createSelectedTopicStore,
  MAX_LOADED_MESSAGES,
  TRIM_SLACK,
} from "./selected-topic-store";

const eventSet = {
  mqttMessages: "msgs",
  mqttClearHistory: "clear",
} as any;

const message = (i: number, topic = "factory/line1") => ({
  id: `${i}`,
  topic,
  payload: btoa(`payload-${i}`),
  qos: 0,
  retain: false,
  timeMs: i,
});

const makeStore = () => {
  const store = createSelectedTopicStore(1, eventSet);
  const unsubscribe = store.subscribe(() => {});
  return { store, unsubscribe };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.getSettings.mockResolvedValue({ recordingEnabled: false });
  mocks.getHist.mockResolvedValue([]);
  mocks.getWindow.mockResolvedValue([]);
  mocks.getCount.mockResolvedValue(0);
});

describe("selected-topic-store memory mode", () => {
  it("shows in-memory history", async () => {
    mocks.getHist.mockResolvedValue([message(1)]);
    const { store, unsubscribe } = makeStore();

    await store.selectTopic("factory/line1");

    const state = get(store);
    expect(state.selectedTopic).toBe("factory/line1");
    expect(state.history).toHaveLength(1);
    expect(state.history[0].payload).toBe("payload-1");
    unsubscribe();
  });

  it("shows missing retained history as an empty timeline", async () => {
    mocks.getHist.mockRejectedValue(
      new Error("topic not found in message history")
    );
    const { store, unsubscribe } = makeStore();

    await expect(store.selectTopic("dropped/topic")).resolves.toBeUndefined();

    const state = get(store);
    expect(state.selectedTopic).toBe("dropped/topic");
    expect(state.history).toEqual([]);
    expect(state.totalCount).toBe(0);
    expect(state.historySource).toBe("memory");
    unsubscribe();
  });

  it("appends live messages after retained history was evicted", async () => {
    mocks.getHist.mockRejectedValue(new Error("topic not found"));
    const { store, unsubscribe } = makeStore();
    await store.selectTopic("dropped/topic");

    for (const cb of mocks.handlers.get("msgs") ?? []) {
      cb({ data: [message(1, "dropped/topic")] });
    }

    expect(get(store).history).toHaveLength(1);
    unsubscribe();
  });

  it("caps initial history to newest renderer entries", async () => {
    const total = MAX_LOADED_MESSAGES + 2000;
    mocks.getHist.mockResolvedValue(
      Array.from({ length: total }, (_, i) => message(i))
    );
    const { store, unsubscribe } = makeStore();

    await store.selectTopic("factory/line1");

    const state = get(store);
    expect(state.history).toHaveLength(MAX_LOADED_MESSAGES);
    expect(state.history[0].id).toBe(`${total - MAX_LOADED_MESSAGES}`);
    expect(state.history.at(-1)?.id).toBe(`${total - 1}`);
    expect(state.totalCount).toBe(total);
    unsubscribe();
  });

  it("evicts oldest live entries after cap plus slack", async () => {
    const { store, unsubscribe } = makeStore();
    await store.selectTopic("factory/line1");
    const emit = [...(mocks.handlers.get("msgs") ?? [])][0];
    const batchSize = 100;
    const batches =
      Math.ceil((MAX_LOADED_MESSAGES + TRIM_SLACK) / batchSize) + 5;

    for (let batch = 0; batch < batches; batch++) {
      emit({
        data: Array.from({ length: batchSize }, (_, i) =>
          message(batch * batchSize + i)
        ),
      });
    }

    const state = get(store);
    expect(state.history.length).toBeLessThanOrEqual(
      MAX_LOADED_MESSAGES + TRIM_SLACK
    );
    expect(Number(state.history[0].id)).toBeGreaterThan(0);
    expect(state.history.at(-1)?.id).toBe(`${batches * batchSize - 1}`);
    expect(state.totalCount).toBe(batches * batchSize);
    unsubscribe();
  });

  it("leaves small live history untouched", async () => {
    const { store, unsubscribe } = makeStore();
    await store.selectTopic("factory/line1");
    const emit = [...(mocks.handlers.get("msgs") ?? [])][0];

    emit({ data: [message(0), message(1)] });

    const state = get(store);
    expect(state.history).toHaveLength(2);
    expect(state.history[0].payload).toBe("payload-0");
    unsubscribe();
  });
});
