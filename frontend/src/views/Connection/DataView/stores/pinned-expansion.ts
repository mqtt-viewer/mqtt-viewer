import { writable } from "svelte/store";

export type PinnedExpansionStore = ReturnType<
  typeof createPinnedExpansionStore
>;

const storageKey = (connectionId: number) =>
  `mqtt-viewer-pinned-expansion:${connectionId}`;

/** Whether `topic` is a pin or sits anywhere beneath one. */
export const isUnderAnyPin = (topic: string, pins: string[]) =>
  pins.some((pin) => topic === pin || topic.startsWith(`${pin}/`));

/**
 * Which topics are open in the pinned block above the tree. Kept apart from
 * the tree's own expanded set so opening a branch in one leaves the other
 * alone, and owned by DataView rather than the tree so it survives the tree
 * being remounted.
 *
 * Persisted in localStorage per connection, like the graph's settings and the
 * last-used view. Unlike the pins themselves (SQLite, shared with the pop-out)
 * this is per-window UI state, so localStorage reaching only this webview is
 * the right scope. A null connectionId keeps it in memory only (stories, tests).
 */
export const createPinnedExpansionStore = (
  connectionId: number | null,
  initial: Iterable<string> = []
) => {
  const key = connectionId === null ? null : storageKey(connectionId);

  const load = (): Set<string> => {
    if (key === null) return new Set(initial);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return new Set(initial);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set(initial);
      return new Set(parsed.filter((t): t is string => typeof t === "string"));
    } catch (e) {
      console.error("pinned expansion load failed", e);
      return new Set(initial);
    }
  };

  let current = load();
  const { subscribe, set } = writable<Set<string>>(current);

  // A fresh Set on every change so anything holding the previous value (a
  // reactive row build mid-flight) never sees it mutate underneath it.
  const commit = (next: Set<string>) => {
    current = next;
    set(next);
    if (key === null) return;
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch (e) {
      console.error("pinned expansion save failed", e);
    }
  };

  const expand = (topic: string) => {
    if (current.has(topic)) return;
    commit(new Set(current).add(topic));
  };

  const toggle = (topic: string) => {
    const next = new Set(current);
    if (!next.delete(topic)) next.add(topic);
    commit(next);
  };

  /**
   * Forget anything no longer under a pin. Only called with an authoritative
   * pin list (see PinnedTopicsChange), never the empty value a pinned store
   * holds before its first load, or a restart would wipe every open branch.
   */
  const prune = (pins: string[]) => {
    const next = new Set([...current].filter((t) => isUnderAnyPin(t, pins)));
    if (next.size !== current.size) commit(next);
  };

  return { subscribe, expand, toggle, prune };
};
