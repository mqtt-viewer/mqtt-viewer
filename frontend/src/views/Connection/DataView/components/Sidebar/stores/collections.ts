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
} from "wailsjs/go/app/App";
import { writable } from "svelte/store";
import { app, models } from "wailsjs/go/models";
import { addToast } from "@/components/Toast/Toast.svelte";

export type CollectionScope = "global" | "connection";

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

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

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

  // Applies a targeted change locally (matching the backend's name ordering)
  // and tells other connections' stores to refetch shared state.
  const apply = (fn: (collections: models.Collection[]) => void) => {
    update((store) => {
      fn(store.collections);
      store.collections.sort(byName);
      for (const collection of store.collections) {
        collection.messages?.sort(byName);
      }
      return store;
    });
    notifyOtherStores(load);
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

  const saveMessage = async (
    params: Omit<app.SaveCollectionMessageParams, "convertValues">
  ) => {
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
    renameMessage,
    moveMessage,
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
