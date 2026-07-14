import type { DataSet } from "vis-data";
import type { DataItem, IdType } from "vis-timeline/peer";
import {
  MAX_LOADED_MESSAGES,
  TRIM_SLACK,
} from "../../../stores/selected-topic-store";

// The timeline keeps its own DataSet of live-appended messages, so it needs
// the same bound as the store's history array: once the set exceeds
// MAX_LOADED_MESSAGES + TRIM_SLACK, drop the oldest items (insertion order)
// down to MAX_LOADED_MESSAGES. Returns the removed ids so the caller can fix
// up selection state.
export const evictOldestTimelineItems = (
  dataSet: DataSet<DataItem, "id">
): IdType[] => {
  if (dataSet.length <= MAX_LOADED_MESSAGES + TRIM_SLACK) return [];
  const removeCount = dataSet.length - MAX_LOADED_MESSAGES;
  const oldest = dataSet.getIds().slice(0, removeCount);
  dataSet.remove(oldest);
  return oldest;
};
