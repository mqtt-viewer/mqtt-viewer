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
import { derived, get, writable } from "svelte/store";
import { app, models } from "wailsjs/go/models";
import { getContext, setContext } from "svelte";

export type CollectionScope = "global" | "connection";

interface CollectionsState {
  collections: models.Collection[];
  isLoaded: boolean;
}

export type CollectionsStore = ReturnType<typeof createCollectionsStore>;

const contextKey = "collections";

export const getCollectionsStoreFromContext = () => {
  return getContext(contextKey) as CollectionsStore;
};

export const createCollectionsStore = (connId: number) => {
  const { subscribe, set, update } = writable<CollectionsState>(
    {
      collections: [],
      isLoaded: false,
    },
    () => {
      load();
    }
  );

  const load = async () => {
    try {
      const collections = await GetCollectionsForConnection(connId);
      set({ collections: collections ?? [], isLoaded: true });
    } catch (e) {
      console.error("failed to load collections", e);
    }
  };

  const createCollection = async (name: string, scope: CollectionScope) => {
    const created = await CreateCollection(
      app.CreateCollectionParams.createFrom({
        name,
        connectionId: scope === "connection" ? connId : undefined,
      })
    );
    await load();
    return created;
  };

  const renameCollection = async (id: number, name: string) => {
    await RenameCollection(id, name);
    await load();
  };

  const deleteCollection = async (id: number) => {
    await DeleteCollection(id);
    await load();
  };

  const saveMessage = async (
    params: Omit<app.SaveCollectionMessageParams, "convertValues">
  ) => {
    const saved = await SaveCollectionMessage(
      app.SaveCollectionMessageParams.createFrom(params)
    );
    await load();
    return saved;
  };

  const renameMessage = async (id: number, name: string) => {
    await RenameCollectionMessage(id, name);
    await load();
  };

  const moveMessage = async (id: number, targetCollectionId: number) => {
    await MoveCollectionMessage(id, targetCollectionId);
    await load();
  };

  const duplicateMessage = async (id: number) => {
    const copy = await DuplicateCollectionMessage(id);
    await load();
    return copy;
  };

  const deleteMessage = async (id: number) => {
    await DeleteCollectionMessage(id);
    await load();
  };

  const findMessage = (id: number): models.CollectionMessage | undefined => {
    for (const collection of get({ subscribe }).collections) {
      const match = (collection.messages ?? []).find((m) => m.id === id);
      if (match) return match;
    }
    return undefined;
  };

  const store = {
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
    findMessage,
  };

  setContext(contextKey, store);

  return store;
};

export const filterByScope = (
  collections: models.Collection[],
  scope: CollectionScope
) => {
  return collections.filter((c) =>
    scope === "global" ? c.connectionId == null : c.connectionId != null
  );
};
