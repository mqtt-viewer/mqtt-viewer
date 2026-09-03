import {
  GetCollectionsForConnection,
  CreateCollection,
  RenameCollection,
  DeleteCollection,
  SaveCollectionMessage,
  RenameCollectionMessage,
  MoveCollectionMessage,
  DuplicateCollectionMessage,
  DeleteCollectionMessage,
  ReorderCollectionMessages,
  ReorderCollections,
} from "bindings/mqtt-viewer/backend/app/app";
import { get, writable } from "svelte/store";
import * as app from "bindings/mqtt-viewer/backend/app/models";
import type * as models from "bindings/mqtt-viewer/backend/models/models";
import { addToast } from "@/components/Toast/Toast.svelte";
import { reorderIds } from "../dnd/drop-index";

export type CollectionScope = "global" | "connection";

// v3 bindings type nullable Go pointer fields as `T | null` and keep them as
// required keys, but callers build these params with the nullable fields either
// `undefined` or omitted entirely. Make nullable fields optional keys that also
// accept `undefined`; the generated `createFrom` normalises the runtime shape.
type NullableKeys<T> = {
  [K in keyof T]-?: null extends T[K] ? K : never;
}[keyof T];

type SaveMessageParams = Partial<
  Pick<app.SaveCollectionMessageParams, NullableKeys<app.SaveCollectionMessageParams>>
> &
  Omit<
    app.SaveCollectionMessageParams,
    NullableKeys<app.SaveCollectionMessageParams>
  >;

interface CollectionsState {
  collections: models.Collection[];
  isLoaded: boolean;
}

export type CollectionsStore = ReturnType<typeof createCollectionsStore>;

// Global collections are shared across connections, so every sidebar's store
// listens for mutations made by the others and refetches.
const storeRegistry = new Set<() => void>();
const notifyOtherStores = (self: () => void) => {
  for (const reload of storeRegistry) {
    if (reload !== self) reload();
  }
};

// Collections and messages carry an explicit Position, set by dragging. Ties
// fall back to id, which is the order things were created in.
const byPosition = (
  a: { position: number; id: number },
  b: { position: number; id: number }
) => a.position - b.position || a.id - b.id;

export const createCollectionsStore = (connId: number) => {
  const { subscribe, set, update } = writable<CollectionsState>(
    {
      collections: [],
      isLoaded: false,
    },
    () => {
      load();
      storeRegistry.add(load);
      return () => storeRegistry.delete(load);
    }
  );

  const load = async () => {
    try {
      const collections = await GetCollectionsForConnection(connId);
      set({ collections: collections ?? [], isLoaded: true });
    } catch (e) {
      console.error("failed to load collections", e);
      addToast({
        data: {
          title: "Failed to load collections",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  // Applies a targeted change locally, matching the backend's position
  // ordering. Global collections are shared, so anything already written to
  // the database is followed by notifyOtherStores.
  const applyLocal = (fn: (collections: models.Collection[]) => void) => {
    update((store) => {
      fn(store.collections);
      store.collections.sort(byPosition);
      for (const collection of store.collections) {
        collection.messages?.sort(byPosition);
      }
      return store;
    });
  };

  const apply = (fn: (collections: models.Collection[]) => void) => {
    applyLocal(fn);
    notifyOtherStores(load);
  };

  // Undoes an optimistic change by refetching, and says why.
  const rollback = async (title: string, e: unknown) => {
    await load();
    addToast({
      data: { title, description: e as string, type: "error" },
    });
  };

  const removeMessageById = (
    collections: models.Collection[],
    id: number
  ): models.CollectionMessage | undefined => {
    for (const collection of collections) {
      const index = (collection.messages ?? []).findIndex((m) => m.id === id);
      if (index >= 0) {
        return collection.messages.splice(index, 1)[0];
      }
    }
    return undefined;
  };

  const insertMessage = (
    collections: models.Collection[],
    message: models.CollectionMessage
  ) => {
    const target = collections.find((c) => c.id === message.collectionId);
    if (!target) return;
    target.messages = [
      ...(target.messages ?? []).filter((m) => m.id !== message.id),
      message,
    ];
  };

  const createCollection = async (name: string, scope: CollectionScope) => {
    const created = await CreateCollection(
      app.CreateCollectionParams.createFrom({
        name,
        connectionId: scope === "connection" ? connId : undefined,
      })
    );
    apply((collections) => {
      created.messages = created.messages ?? [];
      collections.push(created);
    });
    return created;
  };

  const renameCollection = async (id: number, name: string) => {
    const renamed = await RenameCollection(id, name);
    apply((collections) => {
      const collection = collections.find((c) => c.id === id);
      if (collection) collection.name = renamed.name;
    });
  };

  const deleteCollection = async (id: number) => {
    await DeleteCollection(id);
    apply((collections) => {
      const index = collections.findIndex((c) => c.id === id);
      if (index >= 0) collections.splice(index, 1);
    });
  };

  const saveMessage = async (params: SaveMessageParams) => {
    const saved = await SaveCollectionMessage(
      app.SaveCollectionMessageParams.createFrom(params)
    );
    apply((collections) => {
      removeMessageById(collections, saved.id);
      insertMessage(collections, saved);
    });
    return saved;
  };

  const renameMessage = async (id: number, name: string) => {
    const renamed = await RenameCollectionMessage(id, name);
    apply((collections) => {
      for (const collection of collections) {
        const message = (collection.messages ?? []).find((m) => m.id === id);
        if (message) message.name = renamed.name;
      }
    });
  };

  const moveMessage = async (id: number, targetCollectionId: number) => {
    const moved = await MoveCollectionMessage(id, targetCollectionId);
    apply((collections) => {
      removeMessageById(collections, id);
      insertMessage(collections, moved);
    });
  };

  // Rewrites one folder's message order, and pulls in any message listed that
  // currently lives elsewhere. One call covers a reorder and a cross-folder
  // move; the source folder is left with gaps, which is harmless because only
  // the relative order is read.
  const reorderMessages = async (
    collectionId: number,
    orderedIds: number[]
  ) => {
    applyLocal((collections) => {
      const target = collections.find((c) => c.id === collectionId);
      if (!target) return;
      const moved: models.CollectionMessage[] = [];
      for (const id of orderedIds) {
        const message = removeMessageById(collections, id);
        if (message) moved.push(message);
      }
      moved.forEach((message, index) => {
        message.collectionId = collectionId;
        message.position = index;
      });
      target.messages = moved;
    });
    try {
      await ReorderCollectionMessages(collectionId, orderedIds);
      notifyOtherStores(load);
    } catch (e) {
      await rollback("Failed to reorder messages", e);
    }
  };

  // Rewrites the folder order within one scope. Folders never change scope
  // this way; the backend rejects an id that is not already in it.
  const reorderCollections = async (
    scope: CollectionScope,
    orderedIds: number[]
  ) => {
    applyLocal((collections) => {
      orderedIds.forEach((id, index) => {
        const collection = collections.find((c) => c.id === id);
        if (collection) collection.position = index;
      });
    });
    try {
      await ReorderCollections(
        scope === "connection" ? connId : null,
        orderedIds
      );
      notifyOtherStores(load);
    } catch (e) {
      await rollback("Failed to reorder collections", e);
    }
  };

  // Saves a new message and puts it at a given place in its folder. Saving
  // appends, so this is a save followed by a reorder; both are optimistic, so
  // the row does not visibly jump.
  const saveMessageAt = async (
    params: SaveMessageParams,
    index: number | null
  ) => {
    const saved = await saveMessage(params);
    if (index === null) return saved;
    const target = get({ subscribe }).collections.find(
      (c) => c.id === params.collectionId
    );
    const ids = (target?.messages ?? []).map((m) => m.id);
    const from = ids.indexOf(saved.id);
    if (from < 0) return saved;
    await reorderMessages(params.collectionId, reorderIds(ids, from, index));
    return saved;
  };

  const duplicateMessage = async (id: number) => {
    const copy = await DuplicateCollectionMessage(id);
    apply((collections) => {
      insertMessage(collections, copy);
    });
    return copy;
  };

  const deleteMessage = async (id: number) => {
    await DeleteCollectionMessage(id);
    apply((collections) => {
      removeMessageById(collections, id);
    });
  };

  return {
    subscribe,
    load,
    createCollection,
    renameCollection,
    deleteCollection,
    saveMessage,
    saveMessageAt,
    renameMessage,
    moveMessage,
    reorderMessages,
    reorderCollections,
    duplicateMessage,
    deleteMessage,
  };
};

export const filterByScope = (
  collections: models.Collection[],
  scope: CollectionScope
) => {
  return collections.filter((c) =>
    scope === "global" ? c.connectionId == null : c.connectionId != null
  );
};
