import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPinnedTopicsStore, type PinnedTopics } from "./pinned-topics";

const GetPinnedTopics = vi.fn();
const PinTopic = vi.fn();
const UnpinTopic = vi.fn();
const UnpinAllTopics = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetPinnedTopics: (...args: unknown[]) => GetPinnedTopics(...args),
  PinTopic: (...args: unknown[]) => PinTopic(...args),
  UnpinTopic: (...args: unknown[]) => UnpinTopic(...args),
  UnpinAllTopics: (...args: unknown[]) => UnpinAllTopics(...args),
}));

const listeners = new Map<string, (e: any) => void>();

vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: vi.fn((eventName: string, handler: (e: any) => void) => {
      listeners.set(eventName, handler);
      return () => listeners.delete(eventName);
    }),
    Emit: vi.fn(),
  },
}));

const rows = (...topics: string[]) =>
  topics.map((topic, i) => ({ id: i + 1, connectionId: 1, topic, position: i }));

// Subscribes and keeps the latest value, the way a component would. Returns
// the live value holder plus the unsubscribe handle.
const observe = (store: { subscribe: (fn: (v: PinnedTopics) => void) => () => void }) => {
  const seen: { value: PinnedTopics } = {
    value: { order: [], set: new Set() },
  };
  const off = store.subscribe((v) => (seen.value = v));
  return { seen, off };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("pinned-topics store", () => {
  beforeEach(() => {
    listeners.clear();
    GetPinnedTopics.mockReset();
    PinTopic.mockReset().mockResolvedValue(undefined);
    UnpinTopic.mockReset().mockResolvedValue(undefined);
    UnpinAllTopics.mockReset().mockResolvedValue(undefined);
  });

  it("loads the persisted pins on first subscription", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one", "b/two"));
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);

    await flush();

    expect(GetPinnedTopics).toHaveBeenCalledWith(1);
    expect(seen.value.order).toEqual(["a/one", "b/two"]);
    expect(seen.value.set.has("b/two")).toBe(true);
    off();
  });

  it("retries the load on a later subscription when it failed", async () => {
    GetPinnedTopics.mockRejectedValueOnce(new Error("db locked"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createPinnedTopicsStore(1);
    observe(store).off();
    await flush();

    GetPinnedTopics.mockResolvedValue(rows("a/one"));
    const { seen, off } = observe(store);
    await flush();

    expect(GetPinnedTopics).toHaveBeenCalledTimes(2);
    expect(seen.value.order).toEqual(["a/one"]);
    off();
  });

  it("pin appends optimistically and writes through", async () => {
    GetPinnedTopics.mockResolvedValue([]);
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);
    await flush();

    store.pin("a/one");
    store.pin("b/two");

    expect(seen.value.order).toEqual(["a/one", "b/two"]);
    expect(store.isPinned("a/one")).toBe(true);
    expect(PinTopic).toHaveBeenCalledWith(1, "a/one");
    expect(PinTopic).toHaveBeenCalledWith(1, "b/two");
    off();
  });

  it("pinning an already-pinned topic does nothing", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one", "b/two"));
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);
    await flush();

    store.pin("a/one");

    expect(seen.value.order).toEqual(["a/one", "b/two"]);
    expect(PinTopic).not.toHaveBeenCalled();
    off();
  });

  it("unpin removes one topic and keeps the rest in order", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one", "b/two", "c/three"));
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);
    await flush();

    store.unpin("b/two");

    expect(seen.value.order).toEqual(["a/one", "c/three"]);
    expect(UnpinTopic).toHaveBeenCalledWith(1, "b/two");
    off();
  });

  it("toggle pins then unpins", async () => {
    GetPinnedTopics.mockResolvedValue([]);
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);
    await flush();

    store.toggle("a/one");
    expect(seen.value.order).toEqual(["a/one"]);
    store.toggle("a/one");
    expect(seen.value.order).toEqual([]);
    off();
  });

  it("unpinAll clears every pin", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one", "b/two"));
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);
    await flush();

    store.unpinAll();

    expect(seen.value.order).toEqual([]);
    expect(UnpinAllTopics).toHaveBeenCalledWith(1);
    off();
  });

  it("reloads on PinnedTopicsChanged for this connection only", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one"));
    const store = createPinnedTopicsStore(7);
    const { seen, off } = observe(store);
    await flush();

    const handler = listeners.get("PinnedTopicsChanged");
    expect(handler).toBeDefined();

    GetPinnedTopics.mockResolvedValue(rows("a/one", "z/nine"));
    handler?.({ data: { connectionId: 8 } });
    await flush();
    expect(seen.value.order).toEqual(["a/one"]);

    handler?.({ data: { connectionId: 7 } });
    await flush();
    expect(seen.value.order).toEqual(["a/one", "z/nine"]);
    off();
  });

  it("reverts to the persisted pins when a write fails", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one"));
    PinTopic.mockRejectedValue(new Error("db locked"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);
    await flush();

    store.pin("b/two");
    expect(seen.value.order).toEqual(["a/one", "b/two"]);

    await flush();
    expect(seen.value.order).toEqual(["a/one"]);
    off();
  });

  it("keeps the newer result when two reloads resolve out of order", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one"));
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);
    await flush();
    expect(seen.value.order).toEqual(["a/one"]);

    const handler = listeners.get("PinnedTopicsChanged")!;

    // The first reload reads the stale database state and is slow; the second
    // reads the fresh state and lands first.
    let resolveFirst: (v: unknown) => void = () => {};
    GetPinnedTopics.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve))
    );
    GetPinnedTopics.mockImplementationOnce(() =>
      Promise.resolve(rows("a/one", "b/two"))
    );

    handler({ data: { connectionId: 1 } });
    handler({ data: { connectionId: 1 } });
    await flush();
    expect(seen.value.order).toEqual(["a/one", "b/two"]);

    resolveFirst(rows("a/one"));
    await flush();

    expect(seen.value.order).toEqual(["a/one", "b/two"]);
    off();
  });

  it("an unpin during an in-flight reload is not reverted by it", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one", "b/two"));
    const store = createPinnedTopicsStore(1);
    const { seen, off } = observe(store);
    await flush();

    const handler = listeners.get("PinnedTopicsChanged")!;
    let resolveReload: (v: unknown) => void = () => {};
    GetPinnedTopics.mockImplementationOnce(
      () => new Promise((resolve) => (resolveReload = resolve))
    );
    handler({ data: { connectionId: 1 } });

    store.unpin("a/one");
    expect(seen.value.order).toEqual(["b/two"]);

    // The read predates the unpin, so its result must not put the pin back.
    resolveReload(rows("a/one", "b/two"));
    await flush();

    expect(seen.value.order).toEqual(["b/two"]);
    off();
  });

  it("re-reads the pins when it is subscribed to again", async () => {
    GetPinnedTopics.mockResolvedValue(rows("a/one"));
    const store = createPinnedTopicsStore(1);
    const first = observe(store);
    await flush();
    expect(first.seen.value.order).toEqual(["a/one"]);
    first.off();

    // Another window pinned something while nothing here was subscribed.
    GetPinnedTopics.mockResolvedValue(rows("a/one", "b/two"));
    const second = observe(store);
    await flush();

    expect(GetPinnedTopics).toHaveBeenCalledTimes(2);
    expect(second.seen.value.order).toEqual(["a/one", "b/two"]);
    second.off();
  });

  it("drops the event listener when the last subscriber leaves", async () => {
    GetPinnedTopics.mockResolvedValue([]);
    const store = createPinnedTopicsStore(1);
    const { off } = observe(store);
    await flush();

    expect(listeners.has("PinnedTopicsChanged")).toBe(true);
    off();
    expect(listeners.has("PinnedTopicsChanged")).toBe(false);
  });
});
