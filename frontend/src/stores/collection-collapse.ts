import { writable } from "svelte/store";
import {
  GetCollectionCollapsedStates,
  SetCollectionCollapsed,
} from "bindings/mqtt-viewer/backend/app/app";

// Collapsed collection folder ids, shared by every sidebar. Persisted as
// keyed CollectionCollapsedState rows; a missing id means expanded.
const { subscribe, update } = writable<Set<number>>(new Set(), () => {
  load();
});

let hasLoaded = false;

const load = async () => {
  if (hasLoaded) return;
  hasLoaded = true;
  try {
    const states = await GetCollectionCollapsedStates();
    const collapsed = new Set<number>();
    for (const state of states ?? []) {
      if (state.collapsed) collapsed.add(state.id);
    }
    update((ids) => {
      for (const id of collapsed) ids.add(id);
      return ids;
    });
  } catch (e) {
    // Allow the next first-subscription to retry rather than losing the
    // persisted state for the whole session.
    hasLoaded = false;
    console.error("failed to load collection collapse state", e);
  }
};

const toggle = (collectionId: number) => {
  update((ids) => {
    const collapsed = !ids.has(collectionId);
    if (collapsed) {
      ids.add(collectionId);
    } else {
      ids.delete(collectionId);
    }
    SetCollectionCollapsed(collectionId, collapsed).catch((e) =>
      console.error("failed to save collection collapse state", e)
    );
    return ids;
  });
};

export default { subscribe, toggle };
