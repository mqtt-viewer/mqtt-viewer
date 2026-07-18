import { peekScore, LIST_RATE_TAU_MS } from "@/util/decay-score";
import type { MqttData } from "../../stores/mqtt-data";
import type { MqttDataSortDirection, MqttDataSortKey } from "../../stores/sort";

export const getSortedDataKeys = (
  data: MqttData,
  sortKey: MqttDataSortKey,
  sortDirection: MqttDataSortDirection
) => {
  // Capture one `now` for the whole pass and precompute each key's decayed rate
  // via a NON-mutating peek. When the search box is empty, `data` is the live
  // store (uncloned), so a mutating decay here would corrupt the score objects
  // the next arrival depends on. Precomputing also keeps it to one decay per
  // node instead of one per comparison. Uniform decay preserves sibling rank
  // between arrivals, so no re-sort ticker is needed.
  let rateByKey: Record<string, number> | undefined;
  if (sortKey === "rate") {
    const now = Date.now();
    rateByKey = {};
    for (const key of Object.keys(data)) {
      const rate = data[key].rate;
      rateByKey[key] = rate ? peekScore(rate, now, LIST_RATE_TAU_MS) : 0;
    }
  }

  const sortedDataKeys = Object.keys(data).sort((a, b) => {
    let res = 0;
    if (sortKey === "time") {
      const aTime = data[a].latestMessageTime.getTime();
      const bTime = data[b].latestMessageTime.getTime();
      res = bTime <= aTime ? 1 : -1;
    } else if (sortKey === "topic") {
      res = b.localeCompare(a);
    } else if (sortKey === "rate") {
      const aRate = rateByKey![a];
      const bRate = rateByKey![b];
      res = bRate <= aRate ? 1 : -1;
    } else if (sortKey === "count") {
      const aCount = data[a].messageCount ?? 0;
      const bCount = data[b].messageCount ?? 0;
      res = bCount <= aCount ? 1 : -1;
    }
    return sortDirection === "desc" ? res * -1 : res;
  });
  return sortedDataKeys;
};
