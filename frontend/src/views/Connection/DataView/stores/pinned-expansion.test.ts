import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  createPinnedExpansionStore,
  expandedUnder,
  parsePinnedExpansion,
  type PinnedExpansion,
} from "./pinned-expansion";

// The unit project runs in node, so give the store a minimal localStorage and
// a window that records its storage listeners.
const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};
const storageListeners = new Set<(e: any) => void>();
(globalThis as any).window = {
  addEventListener: (type: string, fn: (e: any) => void) => {
    if (type === "storage") storageListeners.add(fn);
  },
  removeEventListener: (type: string, fn: (e: any) => void) => {
    if (type === "storage") storageListeners.delete(fn);
  },
};

// What another tab writing the key looks like from here: the value lands in
// the shared storage and a storage event fires in every other tab.
const writeFromOtherTab = (key: string, value: string | null) => {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  for (const fn of storageListeners) fn({ key, newValue: value });
};

const plain = (expansion: PinnedExpansion) =>
  Object.fromEntries(
    [...expansion].map(([root, set]) => [root, [...set].sort()])
  );

const KEY = (id: number) => `mqtt-viewer-pinned-expansion:${id}`;

describe("pinned expansion store", () => {
  beforeEach(() => {
    memory.clear();
    storageListeners.clear();
  });
  afterEach(() => storageListeners.clear());

  it("toggles and expands per pin", () => {
    const store = createPinnedExpansionStore(null);
    store.toggle("a", "a");
    store.expand("a", "a/b");
    expect(plain(get(store))).toEqual({ a: ["a", "a/b"] });
    store.toggle("a", "a");
    expect(plain(get(store))).toEqual({ a: ["a/b"] });
  });

  it("keeps the same topic independent under two pins", () => {
    // Pins `f` and `f/line`: `f/line` is a pin row of its own and a
    // descendant row under `f`.
    const store = createPinnedExpansionStore(null, { f: ["f"] });
    store.toggle("f", "f/line");
    expect(expandedUnder(get(store), "f").has("f/line")).toBe(true);
    expect(expandedUnder(get(store), "f/line").has("f/line")).toBe(false);

    store.toggle("f/line", "f/line");
    store.toggle("f", "f/line");
    expect(expandedUnder(get(store), "f").has("f/line")).toBe(false);
    expect(expandedUnder(get(store), "f/line").has("f/line")).toBe(true);
  });

  it("drops a pin's entry once nothing under it is open", () => {
    const store = createPinnedExpansionStore(null);
    store.toggle("a", "a");
    store.toggle("a", "a");
    expect(get(store).has("a")).toBe(false);
  });

  it("prunes pins that are gone", () => {
    const store = createPinnedExpansionStore(null, {
      a: ["a", "a/b"],
      c: ["c", "c/d"],
    });
    store.prune(["c"]);
    expect(plain(get(store))).toEqual({ c: ["c", "c/d"] });
    store.prune([]);
    expect(get(store).size).toBe(0);
  });

  it("persists per connection and survives a new instance", () => {
    const first = createPinnedExpansionStore(7);
    first.toggle("a/b", "a/b");
    expect(plain(get(createPinnedExpansionStore(7)))).toEqual({
      "a/b": ["a/b"],
    });
    expect(get(createPinnedExpansionStore(8)).size).toBe(0);
  });

  it("reads anything but the per-pin shape as nothing open", () => {
    expect(parsePinnedExpansion("{not json").size).toBe(0);
    // The flat array an earlier unreleased build saved.
    expect(parsePinnedExpansion(JSON.stringify(["a", "a/b"])).size).toBe(0);
    expect(parsePinnedExpansion("null").size).toBe(0);
    expect(parsePinnedExpansion("7").size).toBe(0);
    expect(
      plain(parsePinnedExpansion(JSON.stringify({ a: [1, "a"], b: "x" })))
    ).toEqual({ a: ["a"] });
  });

  it("adopts another tab's write while subscribed", () => {
    const store = createPinnedExpansionStore(3);
    let seen: PinnedExpansion = new Map();
    const off = store.subscribe((v) => (seen = v));

    store.toggle("a", "a");
    writeFromOtherTab(KEY(3), JSON.stringify({ a: ["a"], b: ["b"] }));
    expect(plain(seen)).toEqual({ a: ["a"], b: ["b"] });

    // Its next change builds on the other tab's value, not its own stale one.
    store.toggle("c", "c");
    expect(plain(parsePinnedExpansion(memory.get(KEY(3))!))).toEqual({
      a: ["a"],
      b: ["b"],
      c: ["c"],
    });
    off();
  });

  it("ignores other keys and treats a clear as nothing open", () => {
    const store = createPinnedExpansionStore(3);
    let seen: PinnedExpansion = new Map();
    const off = store.subscribe((v) => (seen = v));
    store.toggle("a", "a");

    writeFromOtherTab(KEY(4), JSON.stringify({ z: ["z"] }));
    expect(plain(seen)).toEqual({ a: ["a"] });

    // The store reads storage itself on an event, so clear it for real.
    memory.clear();
    for (const fn of storageListeners) fn({ key: null, newValue: null });
    expect(seen.size).toBe(0);
    off();
  });

  it("adopts what storage holds, not a crossed event's older value", () => {
    const store = createPinnedExpansionStore(3);
    let seen: PinnedExpansion = new Map();
    const off = store.subscribe((v) => (seen = v));

    // Two tabs wrote close together: storage ended on the later write, but
    // the event that reaches this tab still carries the earlier one.
    memory.set(KEY(3), JSON.stringify({ q: ["q"] }));
    for (const fn of storageListeners) {
      fn({ key: KEY(3), newValue: JSON.stringify({ p: ["p"] }) });
    }
    expect(plain(seen)).toEqual({ q: ["q"] });
    off();
  });

  it("only listens while subscribed, and catches up on resubscribe", () => {
    const store = createPinnedExpansionStore(3);
    const off = store.subscribe(() => {});
    expect(storageListeners.size).toBe(1);
    off();
    expect(storageListeners.size).toBe(0);

    // Written elsewhere while nothing here was listening.
    memory.set(KEY(3), JSON.stringify({ b: ["b"] }));
    store.toggle("a", "a");
    expect(plain(parsePinnedExpansion(memory.get(KEY(3))!))).toEqual({
      a: ["a"],
      b: ["b"],
    });

    memory.set(KEY(3), JSON.stringify({ q: ["q"] }));
    expect(plain(get(store))).toEqual({ q: ["q"] });
  });
});
