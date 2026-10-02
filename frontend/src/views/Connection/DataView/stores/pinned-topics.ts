import { writable } from "svelte/store";
import { Events } from "@wailsio/runtime";
import * as events from "bindings/mqtt-viewer/events/models";
import {
  GetPinnedTopics,
  PinTopic,
  UnpinAllTopics,
  UnpinTopic,
} from "bindings/mqtt-viewer/backend/app/app";

/**
 * One connection's pinned topics: `order` is the pin order (newest last) and
 * `set` is the same topics for O(1) membership checks on the tree's hot path.
 */
export interface PinnedTopics {
  order: string[];
  set: Set<string>;
}

export type PinnedTopicsStore = ReturnType<typeof createPinnedTopicsStore>;

/**
 * Why the pins just changed. "pin" is a pin made in this window, reported as
 * it is painted and before it is written. "loaded" is an authoritative read
 * from the database, which is how unpins, and pins from other windows,
 * arrive; only then is `order` the persisted list.
 */
export type PinnedTopicsChange =
  | { kind: "pin"; topic: string }
  | { kind: "loaded" };

export type PinnedTopicsChangeListener = (
  change: PinnedTopicsChange,
  order: string[]
) => void;

/**
 * Pins live in SQLite rather than localStorage because the topic pop-out is a
 * separate webview: a localStorage write here would never reach it. Every
 * window instead loads from GetPinnedTopics and converges on the
 * PinnedTopicsChanged event, which each mutation emits.
 */
export const createPinnedTopicsStore = (connectionId: number) => {
  // Held alongside the store so the mutations below can read the current pins
  // without a get(), which would re-run the start callback (and so re-attach
  // the event listener) whenever nothing is subscribed.
  let current: PinnedTopics = { order: [], set: new Set() };

  const { subscribe, set } = writable<PinnedTopics>(current, () => {
    isSubscribed = true;
    load();
    const off = Events.On(events.GlobalEvent.PinnedTopicsChanged, (e: any) => {
      const raw = e?.data;
      // Wails wraps single-argument event payloads in an array in some
      // builds; accept either shape rather than assuming one.
      const payload = (Array.isArray(raw) ? raw[0] : raw) as
        | { connectionId?: number }
        | undefined;
      if (payload?.connectionId !== connectionId) return;
      reload();
    });
    // Tear the listener down when the last subscriber leaves, so listeners
    // don't accumulate across tab churn.
    return () => {
      off?.();
      isSubscribed = false;
      // The pins can change while nothing is subscribed (another window, or a
      // connection delete), so the next subscription has to read the database
      // again rather than serving whatever was last in memory. Bumping the
      // sequence with it stops a load still in flight from marking the store
      // loaded after we asked for a fresh one.
      loadSeq++;
      hasLoaded = false;
    };
  });

  const apply = (order: string[]) => {
    current = { order, set: new Set(order) };
    set(current);
  };

  // Plain callbacks rather than a second store: listeners care about why the
  // pins changed (a local pin auto-expands in the pinned block, a cross-window
  // one does not), which a value subscription cannot tell them.
  const changeListeners = new Set<PinnedTopicsChangeListener>();
  const notify = (change: PinnedTopicsChange) => {
    for (const listener of changeListeners) listener(change, current.order);
  };
  const onChange = (listener: PinnedTopicsChangeListener) => {
    changeListeners.add(listener);
    return () => {
      changeListeners.delete(listener);
    };
  };

  // Optimistic paints win over any read that was already in flight: the
  // database row the reload is reading predates the mutation, so its result is
  // stale by definition. The mutation emits PinnedTopicsChanged, which starts a
  // fresh reload that does see the write.
  const applyOptimistic = (order: string[]) => {
    loadSeq++;
    apply(order);
  };

  let hasLoaded = false;
  let isSubscribed = false;
  // Guards against out-of-order reads. Two reloads racing (two events, or an
  // event plus a failed-write retry) can resolve in either order, and the
  // loser must not overwrite the winner.
  let loadSeq = 0;

  // Local writes not yet settled, and whether a read was set aside meanwhile.
  // A read that lands while a write is in flight may have been taken before
  // that write committed (another window's change event arriving mid-write
  // starts exactly such a read), and applying it would drop the optimistic
  // pin until the write's own event put it back: a visible flicker. It can
  // also carry another window's change, though, so it is not thrown away but
  // read again once the last write settles, when the database holds both.
  let writesInFlight = 0;
  let isReloadOwed = false;

  const reload = async () => {
    const seq = ++loadSeq;
    try {
      const pinned = await GetPinnedTopics(connectionId);
      if (seq !== loadSeq) return;
      if (writesInFlight > 0) {
        isReloadOwed = true;
        return;
      }
      apply((pinned ?? []).map((pin) => pin.topic));
      hasLoaded = true;
      notify({ kind: "loaded" });
    } catch (e) {
      if (seq !== loadSeq) return;
      // Allow the next first-subscription to retry rather than losing the
      // persisted pins for the whole session.
      hasLoaded = false;
      console.error("failed to load pinned topics", e);
    }
  };

  const load = () => {
    if (hasLoaded) return;
    hasLoaded = true;
    reload();
  };

  // Every mutation paints locally first, then writes through: the pin glyph
  // has to land on the same frame as the click. A failed write reloads, so
  // the UI falls back to what is actually persisted; so does a read that was
  // set aside while writes were in flight. Either way the read waits for the
  // last write to settle, since an earlier one could still miss a write.
  const writeThrough = (write: () => Promise<unknown>, what: string) => {
    writesInFlight++;
    const settle = (failed: boolean) => {
      writesInFlight--;
      if (failed) isReloadOwed = true;
      if (writesInFlight > 0 || !isReloadOwed) return;
      isReloadOwed = false;
      // With nothing subscribed the next subscription reads afresh anyway
      // (hasLoaded was cleared when the last subscriber left).
      if (isSubscribed) reload();
    };
    // A write that throws before returning a promise settles as a failure
    // too, rather than leaving the count up and every later read set aside.
    let written: Promise<unknown>;
    try {
      written = write();
    } catch (e) {
      written = Promise.reject(e);
    }
    written.then(
      () => settle(false),
      (e) => {
        console.error(`failed to ${what}`, e);
        settle(true);
      }
    );
  };

  const pin = (topic: string) => {
    if (current.set.has(topic)) return;
    applyOptimistic([...current.order, topic]);
    notify({ kind: "pin", topic });
    writeThrough(() => PinTopic(connectionId, topic), "pin topic");
  };

  const unpin = (topic: string) => {
    if (!current.set.has(topic)) return;
    applyOptimistic(current.order.filter((t) => t !== topic));
    writeThrough(() => UnpinTopic(connectionId, topic), "unpin topic");
  };

  const toggle = (topic: string) => {
    if (current.set.has(topic)) {
      unpin(topic);
    } else {
      pin(topic);
    }
  };

  const unpinAll = () => {
    if (current.order.length === 0) return;
    applyOptimistic([]);
    writeThrough(() => UnpinAllTopics(connectionId), "unpin all topics");
  };

  const isPinned = (topic: string) => current.set.has(topic);

  return { subscribe, pin, unpin, toggle, unpinAll, isPinned, onChange };
};
