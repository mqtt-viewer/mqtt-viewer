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
    return () => off?.();
  });

  const apply = (order: string[]) => {
    current = { order, set: new Set(order) };
    set(current);
  };

  let hasLoaded = false;

  const reload = async () => {
    try {
      const pinned = await GetPinnedTopics(connectionId);
      apply((pinned ?? []).map((pin) => pin.topic));
      hasLoaded = true;
    } catch (e) {
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
    apply([...current.order, topic]);
    PinTopic(connectionId, topic).catch((e) => {
      console.error("failed to pin topic", e);
      reload();
    });
  };

  const unpin = (topic: string) => {
    if (!current.set.has(topic)) return;
    apply(current.order.filter((t) => t !== topic));
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
    apply([]);
    UnpinAllTopics(connectionId).catch((e) => {
      console.error("failed to unpin all topics", e);
      reload();
    });
  };

  const isPinned = (topic: string) => current.set.has(topic);

  return { subscribe, pin, unpin, toggle, unpinAll, isPinned };
};
