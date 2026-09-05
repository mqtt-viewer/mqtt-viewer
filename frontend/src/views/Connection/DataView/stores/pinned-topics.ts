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

  // Optimistic paints win over any read that was already in flight: the
  // database row the reload is reading predates the mutation, so its result is
  // stale by definition. The mutation emits PinnedTopicsChanged, which starts a
  // fresh reload that does see the write.
  const applyOptimistic = (order: string[]) => {
    loadSeq++;
    apply(order);
  };

  let hasLoaded = false;
  // Guards against out-of-order reads. Two reloads racing (two events, or an
  // event plus a failed-write retry) can resolve in either order, and the
  // loser must not overwrite the winner.
  let loadSeq = 0;

  const reload = async () => {
    const seq = ++loadSeq;
    try {
      const pinned = await GetPinnedTopics(connectionId);
      if (seq !== loadSeq) return;
      apply((pinned ?? []).map((pin) => pin.topic));
      hasLoaded = true;
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
  // the UI falls back to what is actually persisted.
  const pin = (topic: string) => {
    if (current.set.has(topic)) return;
    applyOptimistic([...current.order, topic]);
    PinTopic(connectionId, topic).catch((e) => {
      console.error("failed to pin topic", e);
      reload();
    });
  };

  const unpin = (topic: string) => {
    if (!current.set.has(topic)) return;
    applyOptimistic(current.order.filter((t) => t !== topic));
    UnpinTopic(connectionId, topic).catch((e) => {
      console.error("failed to unpin topic", e);
      reload();
    });
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
    UnpinAllTopics(connectionId).catch((e) => {
      console.error("failed to unpin all topics", e);
      reload();
    });
  };

  const isPinned = (topic: string) => current.set.has(topic);

  return { subscribe, pin, unpin, toggle, unpinAll, isPinned };
};
