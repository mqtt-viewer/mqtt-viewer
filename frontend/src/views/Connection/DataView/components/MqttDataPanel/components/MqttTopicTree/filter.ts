import _ from "lodash";
import type { MqttData } from "../../stores/mqtt-data";

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
  const topic = data.topic.toLowerCase();
  const message = data.message?.toString();
  const text = searchText.toLowerCase();

  const matchesSearch =
    topic.toLowerCase().includes(text) ||
    (message !== undefined && message.toLowerCase().includes(text));

  const searchIsMqttPattern = text.includes("#") || text.includes("+");
  if (!searchIsMqttPattern) {
    return matchesSearch;
  }

  const isValidSearchTopic = validateTopic(text);
  if (!isValidSearchTopic) {
    return matchesSearch;
  }

  const topicMatchesSearch = topicMatchesSubscription(topic, text);
  return matchesSearch || topicMatchesSearch;
};

const topicMatchesSubscription = (topic: string, subscription: string) => {
  const topicLevels = topic.split("/");
  const subscriptionLevels = subscription.split("/");

  for (let i = 0; i < subscriptionLevels.length; i++) {
    const subLevel = subscriptionLevels[i];
    const topicLevel = topicLevels[i];

    if (subLevel === "#") {
      // Multi-level wildcard matches any remaining levels
      return true;
    }

    if (subLevel === "+") {
      // Single-level wildcard matches exactly one level
      continue;
    }

    if (subLevel !== topicLevel) {
      // If levels do not match and it's not a wildcard, return false
      return false;
    }
  }

  // If the subscription is shorter than the topic, it doesn't match
  return topicLevels.length === subscriptionLevels.length;
};

const validateTopic = (topic: string) => {
  const parts = topic.split("/");

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "+") {
      continue;
    }

    if (parts[i] === "#") {
      // for Rule #2
      return i === parts.length - 1;
    }

    if (parts[i].indexOf("+") !== -1 || parts[i].indexOf("#") !== -1) {
      return false;
    }
  }

  return true;
};
