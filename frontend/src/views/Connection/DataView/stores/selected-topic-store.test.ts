import { vi, describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";

// --- Mocks (hoisted so the vi.mock factories can see them) --------------------

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
      const set = mocks.handlers.get(name) ?? new Set();
      set.add(cb);
      mocks.handlers.set(name, set);
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

import { createSelectedTopicStore } from "./selected-topic-store";

const eventSet = {
  mqttMessages: "msgs",
  mqttClearHistory: "clear",
} as any;

const message = (topic: string, payloadB64: string) => ({
  id: "1",
  topic,
  payload: payloadB64,
  qos: 0,
  retain: false,
  timeMs: 1,
});

describe("selected-topic-store memory mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.getSettings.mockResolvedValue({ recordingEnabled: false });
  });

  it("shows the in-memory history for a topic", async () => {
    mocks.getHist.mockResolvedValue([message("factory/line1", "aGk=")]);
    const store = createSelectedTopicStore(1, eventSet);
    store.subscribe(() => {});

    await store.selectTopic("factory/line1");

    const state = get(store);
    expect(state.selectedTopic).toBe("factory/line1");
    expect(state.history).toHaveLength(1);
    expect(state.history[0].payload).toBe("hi");
  });

  // At very high topic cardinality the backend trims its last-value cache, so
  // a topic still listed in the tree can have no history left and the binding
  // rejects with "topic not found in message history". Selecting it must show
  // an empty timeline, not fail.
  it("selects a topic with no retained history as an empty timeline", async () => {
    mocks.getHist.mockRejectedValue(
      new Error("topic not found in message history")
    );
    const store = createSelectedTopicStore(1, eventSet);
    store.subscribe(() => {});

    await expect(store.selectTopic("dropped/topic")).resolves.toBeUndefined();

    const state = get(store);
    expect(state.selectedTopic).toBe("dropped/topic");
    expect(state.history).toEqual([]);
    expect(state.totalCount).toBe(0);
    expect(state.historySource).toBe("memory");
  });

  it("still appends live messages to a topic selected with no history", async () => {
    mocks.getHist.mockRejectedValue(new Error("topic not found"));
    const store = createSelectedTopicStore(1, eventSet);
    store.subscribe(() => {});
    await store.selectTopic("dropped/topic");

    for (const cb of mocks.handlers.get("msgs") ?? []) {
      cb({ data: [message("dropped/topic", "aGk=")] });
    }

    expect(get(store).history).toHaveLength(1);
  });
});
