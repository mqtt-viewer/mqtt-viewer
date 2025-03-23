import type { MqttData } from "../../stores/mqtt-data";
import type { MqttDataSortDirection, MqttDataSortKey } from "../../stores/sort";

export const getSortedDataKeys = (
  data: MqttData,
  sortKey: MqttDataSortKey,
  sortDirection: MqttDataSortDirection
) => {
  const sortedDataKeys = Object.keys(data).sort((a, b) => {
    let res = 0;
    if (sortKey === "time") {
      const aTime = data[a].latestMessageTime.getTime();
      const bTime = data[b].latestMessageTime.getTime();
      res = bTime <= aTime ? 1 : -1;
    } else if (sortKey === "topic") {
      res = b.localeCompare(a);
    }
    return sortDirection === "desc" ? res * -1 : res;
  });
  return sortedDataKeys;
};
