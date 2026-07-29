import _ from "lodash";
import type { MqttData } from "../../stores/mqtt-data";
import { topicMatchesQuery } from "@/util/topic-filter";

export const filterData = (data: MqttData, searchText: string) => {
  if (!searchText) {
    return data;
  }

  const dataToFilter = structuredClone(data);

  const result: MqttData = {};
  for (const key in dataToFilter) {
    const topicData = dataToFilter[key];
    topicData.children = filterData(topicData.children, searchText);
    if (_.isEmpty(topicData.children)) {
      topicData.subtopicCount = 0;
      if (dataMatchesSearch(topicData, searchText)) {
        result[key] = topicData;
      }
      continue;
    }
    // Keep all parents that have children matching search
    let filteredChildMessageCount = 0;
    let filteredSubtopicCount = 0;
    let latestMessageTime = 0;
    for (const childKey in topicData.children) {
      const child = topicData.children[childKey];
      filteredChildMessageCount += child.messageCount ?? 0;
      filteredSubtopicCount++;
      if (child.latestMessageTime.getTime() > latestMessageTime) {
        latestMessageTime = child.latestMessageTime.getTime();
      }
    }
    topicData.messageCount = filteredChildMessageCount;
    topicData.subtopicCount = filteredSubtopicCount;
    topicData.latestMessageTime = new Date(latestMessageTime);
    result[key] = topicData;
  }
  return result;
};

const dataMatchesSearch = (data: MqttData[string], searchText: string) => {
  if (!searchText) {
    return true;
  }
  const message = data.message?.toString();
  return topicMatchesQuery(
    data.topic,
    searchText,
    message !== undefined ? [message] : []
  );
};
