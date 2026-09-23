import defaultSorts from "@/stores/default-sorts";
import { writable } from "svelte/store";

export const DEFAULT_SORT_PERSIST_KEY = "mqtt-data-sort";

export type MqttDataSortKey = "time" | "topic" | "rate" | "msgs";
export type MqttDataSortDirection = "asc" | "desc";

export interface MqtttDataSort {
  key: MqttDataSortKey;
  dir: MqttDataSortDirection;
}

const DEFAULT_SORT: MqtttDataSort = { key: "topic", dir: "desc" };

const VALID_SORT_KEYS: readonly MqttDataSortKey[] = [
  "time",
  "topic",
  "rate",
  "msgs",
];
const VALID_SORT_DIRS: readonly MqttDataSortDirection[] = ["asc", "desc"];

// A persisted sort row can come from a newer build with keys/dirs this build
// doesn't know. Coerce anything unrecognised back to the default so unknown
// values never reach the comparators. Each field defaults independently.
export const validateSort = (key: unknown, dir: unknown): MqtttDataSort => ({
  key: VALID_SORT_KEYS.includes(key as MqttDataSortKey)
    ? (key as MqttDataSortKey)
    : DEFAULT_SORT.key,
  dir: VALID_SORT_DIRS.includes(dir as MqttDataSortDirection)
    ? (dir as MqttDataSortDirection)
    : DEFAULT_SORT.dir,
});

export type MqttDataSortStore = ReturnType<typeof createSortStore>;

export const createSortStore = (defaultSortState?: MqtttDataSort) => {
  const { subscribe, update, set } = writable<MqtttDataSort>(
    defaultSortState ?? DEFAULT_SORT
  );

  const setSort = (key: MqttDataSortKey, dir: MqttDataSortDirection) => {
    set({ key, dir });
    defaultSorts.updateSortState(DEFAULT_SORT_PERSIST_KEY, key, dir);
  };
  return { subscribe, setSort };
};
