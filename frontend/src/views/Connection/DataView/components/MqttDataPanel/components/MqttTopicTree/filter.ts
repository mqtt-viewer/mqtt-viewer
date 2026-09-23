import type { MqttData } from "../../stores/mqtt-data";
import { topicMatchesQuery } from "@/util/topic-filter";

// Builds a pruned copy without deep-cloning the input: new node objects are
// created only for kept entries, unmatched subtrees are never copied, and the
// input tree is left untouched.
export const filterData = (data: MqttData, searchText: string): MqttData => {
  if (!searchText) {
    return data;
  }

  const result: MqttData = {};
  for (const key in data) {
    const topicData = data[key];
    const filteredChildren = filterData(topicData.children, searchText);

    let filteredChildMessageCount = 0;
    let filteredSubtopicCount = 0;
    let latestMessageTime = 0;
    for (const childKey in filteredChildren) {
      const child = filteredChildren[childKey];
      filteredChildMessageCount += child.messageCount ?? 0;
      filteredSubtopicCount++;
      if (child.latestMessageTime.getTime() > latestMessageTime) {
        latestMessageTime = child.latestMessageTime.getTime();
      }
    }

    if (filteredSubtopicCount === 0) {
      if (dataMatchesSearch(topicData, searchText)) {
        result[key] = { ...topicData, children: {}, subtopicCount: 0 };
      }
      continue;
    }

    // Keep all parents that have children matching search
    result[key] = {
      ...topicData,
      children: filteredChildren,
      messageCount: filteredChildMessageCount,
      subtopicCount: filteredSubtopicCount,
      latestMessageTime: new Date(latestMessageTime),
    };
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
