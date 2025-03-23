import defaultSorts from "@/stores/default-sorts";
import { writable } from "svelte/store";

export const DEFAULT_SORT_PERSIST_KEY = "mqtt-data-sort";

export type MqttDataSortKey = "time" | "topic";
export type MqttDataSortDirection = "asc" | "desc";

export interface MqtttDataSort {
  key: MqttDataSortKey;
  dir: MqttDataSortDirection;
}

export type MqttDataSortStore = ReturnType<typeof createSortStore>;

export const createSortStore = (defaultSortState?: MqtttDataSort) => {
  const { subscribe, update, set } = writable<MqtttDataSort>(
    defaultSortState ?? {
      key: "topic",
      dir: "desc",
    }
  );

  const setSort = (key: MqttDataSortKey, dir: MqttDataSortDirection) => {
    set({ key, dir });
    defaultSorts.updateSortState(DEFAULT_SORT_PERSIST_KEY, key, dir);
  };
  return { subscribe, setSort };
};
