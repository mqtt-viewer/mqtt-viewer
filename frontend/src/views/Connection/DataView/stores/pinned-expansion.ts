import { writable } from "svelte/store";

export type PinnedExpansionStore = ReturnType<
  typeof createPinnedExpansionStore
>;

/**
 * What is open in the pinned block, per pin: each pin (its "root") maps to the
 * topics open beneath it, itself included when the pin is open. Keyed by root
 * because one topic can show under several pins (pins `f` and `f/line` both
 * list `f/line`), and opening it in one place must not open it in the other.
 */
export type PinnedExpansion = ReadonlyMap<string, ReadonlySet<string>>;

const EMPTY_TOPICS: ReadonlySet<string> = new Set();

/** The topics open under one pin; an empty set when nothing is. */
export const expandedUnder = (expansion: PinnedExpansion, pinRoot: string) =>
  expansion.get(pinRoot) ?? EMPTY_TOPICS;

const storageKey = (connectionId: number) =>
  `mqtt-viewer-pinned-expansion:${connectionId}`;

/**
 * Read a saved value. Anything that is not `{ [pinRoot]: string[] }` reads as
 * nothing open: an earlier unreleased build saved a flat array, and a stale
 * open branch is not worth a migration.
 */
export const parsePinnedExpansion = (raw: string | null): PinnedExpansion => {
  const result = new Map<string, Set<string>>();
  if (!raw) return result;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return result;
  }
  for (const [root, topics] of Object.entries(parsed)) {
    if (!Array.isArray(topics)) continue;
    const set = new Set(topics.filter((t): t is string => typeof t === "string"));
    if (set.size > 0) result.set(root, set);
  }
  return result;
};

const serialise = (expansion: PinnedExpansion) =>
  JSON.stringify(
    Object.fromEntries([...expansion].map(([root, set]) => [root, [...set]]))
  );

/**
 * Which topics are open in the pinned block above the tree. Kept apart from
 * the tree's own expanded set so opening a branch in one leaves the other
 * alone, and owned by DataView rather than the tree so it survives the tree
 * being remounted.
 *
 * Persisted in localStorage per connection, like the graph's settings and the
 * last-used view. localStorage is shared by every window and tab on the same
 * origin, which matters in server mode, where the app runs in ordinary browser
 * tabs: each instance follows the others' writes through the `storage` event,
 * so two tabs on one connection converge rather than the last writer silently
 * reverting the other. A null connectionId keeps it in memory only (stories,
 * tests).
 */
export const createPinnedExpansionStore = (
  connectionId: number | null,
  initial: Record<string, Iterable<string>> = {}
) => {
  const key = connectionId === null ? null : storageKey(connectionId);

  const load = (): PinnedExpansion => {
    if (key === null) {
      return new Map(
        Object.entries(initial).map(([root, topics]) => [root, new Set(topics)])
      );
    }
    try {
      return parsePinnedExpansion(localStorage.getItem(key));
    } catch (e) {
      console.error("pinned expansion load failed", e);
      return new Map();
    }
  };

  let current = load();
  // Whether the storage listener is attached, i.e. whether `current` is
  // being kept in step with other tabs. While it is not, `current` may be
  // stale, so a change re-reads before building on it.
  let isFollowing = false;

  const onStorage = (event: StorageEvent) => {
    // A null key is a localStorage.clear() somewhere.
    if (event.key !== null && event.key !== key) return;
    // Read storage rather than trusting the event's value: when two tabs
    // write close together the events cross, and each tab would otherwise
    // adopt the other's older write instead of what storage ended up holding.
    current = load();
    set(current);
  };

  const { subscribe, set } = writable<PinnedExpansion>(current, () => {
    if (key === null || typeof window === "undefined") return;
    // Another tab may have written while nothing here was listening.
    current = load();
    set(current);
    window.addEventListener("storage", onStorage);
    isFollowing = true;
    return () => {
      window.removeEventListener("storage", onStorage);
      isFollowing = false;
    };
  });

  // A fresh Map and Sets on every change so anything holding the previous
  // value (a reactive row build mid-flight) never sees it mutate underneath it.
  const commit = (next: PinnedExpansion) => {
    current = next;
    set(next);
    if (key === null) return;
    try {
      localStorage.setItem(key, serialise(next));
    } catch (e) {
      console.error("pinned expansion save failed", e);
    }
  };

  const latest = () => {
    if (key !== null && !isFollowing) current = load();
    return current;
  };

  const withTopics = (
    base: PinnedExpansion,
    pinRoot: string,
    topics: Set<string>
  ) => {
    const next = new Map(base);
    if (topics.size === 0) next.delete(pinRoot);
    else next.set(pinRoot, topics);
    return next;
  };

  /** Open `topic` under the pin `pinRoot`. */
  const expand = (pinRoot: string, topic: string) => {
    const base = latest();
    const topics = expandedUnder(base, pinRoot);
    if (topics.has(topic)) return;
    commit(withTopics(base, pinRoot, new Set(topics).add(topic)));
  };

  /** Open or close `topic` under the pin `pinRoot`, leaving other pins be. */
  const toggle = (pinRoot: string, topic: string) => {
    const base = latest();
    const topics = new Set(expandedUnder(base, pinRoot));
    if (!topics.delete(topic)) topics.add(topic);
    commit(withTopics(base, pinRoot, topics));
  };

  /**
   * Forget pins that are gone. Only called with an authoritative pin list
   * (see PinnedTopicsChange), never the empty value a pinned store holds
   * before its first load, or a restart would wipe every open branch.
   */
  const prune = (pins: string[]) => {
    const base = latest();
    const keep = new Set(pins);
    const next = new Map([...base].filter(([root]) => keep.has(root)));
    if (next.size !== base.size) commit(next);
  };

  return { subscribe, expand, toggle, prune };
};
