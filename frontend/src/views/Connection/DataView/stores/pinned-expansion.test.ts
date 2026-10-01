import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { createPinnedExpansionStore, isUnderAnyPin } from "./pinned-expansion";

// The unit project runs in node, so give the store a minimal localStorage.
const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};

describe("isUnderAnyPin", () => {
  it("matches the pin and anything beneath it on a level boundary", () => {
    expect(isUnderAnyPin("a/b", ["a/b"])).toBe(true);
    expect(isUnderAnyPin("a/b/c", ["a/b"])).toBe(true);
    expect(isUnderAnyPin("a/bc", ["a/b"])).toBe(false);
    expect(isUnderAnyPin("a", ["a/b"])).toBe(false);
  });
});

describe("pinned expansion store", () => {
  beforeEach(() => memory.clear());

  it("toggles and expands", () => {
    const store = createPinnedExpansionStore(null);
    store.toggle("a");
    store.expand("a/b");
    expect([...get(store)].sort()).toEqual(["a", "a/b"]);
    store.toggle("a");
    expect([...get(store)]).toEqual(["a/b"]);
  });

  it("prunes topics no longer under any pin", () => {
    const store = createPinnedExpansionStore(null, ["a", "a/b", "c", "c/d"]);
    store.prune(["c"]);
    expect([...get(store)].sort()).toEqual(["c", "c/d"]);
    store.prune([]);
    expect(get(store).size).toBe(0);
  });

  it("persists per connection and survives a new instance", () => {
    const first = createPinnedExpansionStore(7);
    first.toggle("a/b");
    expect([...get(createPinnedExpansionStore(7))]).toEqual(["a/b"]);
    expect(get(createPinnedExpansionStore(8)).size).toBe(0);
  });

  it("ignores a corrupt saved value", () => {
    memory.set("mqtt-viewer-pinned-expansion:3", "{not json");
    expect(get(createPinnedExpansionStore(3)).size).toBe(0);
    memory.set("mqtt-viewer-pinned-expansion:3", JSON.stringify([1, "x"]));
    expect([...get(createPinnedExpansionStore(3))]).toEqual(["x"]);
  });
});
