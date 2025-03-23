import {
  GetFilterHistoriesForConnection,
  SaveFilterHistoryEntry,
  DeleteFilterHistoryEntry,
} from "wailsjs/go/app/App";
import { writable } from "svelte/store";
import { models } from "wailsjs/go/models";

import type { DeepOmit } from "@/util/types";

export type FilterHistory = DeepOmit<models.FilterHistory, "convertValues">[];

interface FilterHistoryStore {
  filterHistory: FilterHistory;
}

export const createFilterHistoryStore = (connId: number) => {
  const { subscribe, set, update } = writable<FilterHistoryStore>(
    {
      filterHistory: [],
    },
    (set) => {
      loadConnectionFilterHistory(connId);
    }
  );

  const loadConnectionFilterHistory = async (connId: number) => {
    try {
      const filterHistories = await GetFilterHistoriesForConnection(connId);
      set({ filterHistory: filterHistories });
    } catch (e) {
      console.error(e);
    }
  };

  const saveFilterHistoryEntry = async (text: string) => {
    try {
      if (!text || text.trim() === "") {
        return;
      }
      const entry = await SaveFilterHistoryEntry(connId, text);
      console.log("saved filter history entry", entry);
      update((store) => {
        const filtered = store.filterHistory.filter((e) => e.text !== text);
        store.filterHistory = [entry, ...filtered];
        return store;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const deleteFilterHistoryEntry = async (text: string) => {
    try {
      if (!text || text.trim() === "") {
        return;
      }
      await DeleteFilterHistoryEntry(connId, text);
      console.log("deleted filter history entry", text);
      update((store) => {
        store.filterHistory = store.filterHistory.filter(
          (e) => e.text !== text
        );
        return store;
      });
    } catch (e) {
      console.error(e);
    }
  };

  return {
    subscribe,
    saveFilterHistoryEntry,
    deleteFilterHistoryEntry,
  };
};
