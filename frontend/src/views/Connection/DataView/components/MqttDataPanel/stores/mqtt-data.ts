import { get, writable } from "svelte/store";
import type { events, mqtt } from "wailsjs/go/models";
import { EventsOn } from "wailsjs/runtime/runtime";
import type { HighlightedMqttTopicsStore } from "./highlighted-topics";

export type MqttData = {
  [topicLevel: string]: {
    subtopicCount: number;
    messageCount: number;
    topic: string;
    latestMessageTime: Date;
    message?: string; // byte array
    isDecodedProto: boolean;
    children: MqttData;
  };
};

export type MqttDataStore = ReturnType<typeof createMqttDataStore>;

export const createMqttDataStore = (
  highlightedTopicStore: HighlightedMqttTopicsStore,
  eventSet?: events.ConnectionEventsSet
) => {
  const { subscribe, set, update } = writable<MqttData>({}, (set) => {
    if (eventSet !== undefined) {
      EventsOn(eventSet.mqttMessages, (messages: mqtt.MqttMessage[]) => {
        processMessages(messages);
      });
      EventsOn(eventSet.mqttClearHistory, () => {
        resetMqttData();
      });
    }
  });

  const processMessages = (messages: mqtt.MqttMessage[]) => {
    for (const message of messages) {
      const topicLevels = message.topic.split("/");

      for (let i = 0; i < topicLevels.length; i++) {
        const topic = topicLevels.slice(0, i + 1).join("/");
        if (i !== topicLevels.length - 1) {
          highlightedTopicStore.markTopicForHighlight(
            topic,
            message.id,
            "child-update"
          );
        } else {
          highlightedTopicStore.markTopicForHighlight(
            topic,
            message.id,
            "message-update"
          );
        }
      }
      const timestamp = new Date(message.timeMs);
      const decodedMessage = atob(message.payload as unknown as string);
      const isDecodedProto = message?.middlewareProperties?.IsDecodedProto;
      update((mqttData) => {
        return insertMqttMessage(
          mqttData,
          topicLevels,
          0,
          decodedMessage,
          isDecodedProto,
          timestamp
        );
      });
    }
  };

  const insertMqttMessage = (
    mqttData: MqttData,
    topicLevels: string[],
    currentTopicLevel: number,
    message: string,
    isDecodedProto: boolean,
    timestamp: Date
  ) => {
    const topicLevel = topicLevels[currentTopicLevel];
    if (mqttData[topicLevel] !== undefined) {
      if (currentTopicLevel === topicLevels.length - 1) {
        mqttData[topicLevel].messageCount += 1;
        mqttData[topicLevel].message = message;
        mqttData[topicLevel].isDecodedProto = isDecodedProto;
        mqttData[topicLevel].latestMessageTime = timestamp;

        return mqttData;
      }
      const children = insertMqttMessage(
        mqttData[topicLevel].children,
        topicLevels,
        currentTopicLevel + 1,
        message,
        isDecodedProto,
        timestamp
      );
      mqttData[topicLevel].isDecodedProto = isDecodedProto;
      mqttData[topicLevel].messageCount += 1;
      mqttData[topicLevel].children = children;
      mqttData[topicLevel].subtopicCount = getSubtopicCount(children);
      mqttData[topicLevel].latestMessageTime = timestamp;
      return mqttData;
    }

    if (currentTopicLevel === topicLevels.length - 1) {
      const topic = topicLevels.join("/");
      mqttData[topicLevel] = {
        subtopicCount: 0,
        messageCount: 1,
        topic,
        isDecodedProto,
        message,
        children: {},
        latestMessageTime: timestamp,
      };
      return mqttData;
    }

    const children = insertMqttMessage(
      {},
      topicLevels,
      currentTopicLevel + 1,
      message,
      false,
      timestamp
    );
    const topic = topicLevels.slice(0, currentTopicLevel + 1).join("/");
    mqttData[topicLevel] = {
      subtopicCount: getSubtopicCount(children),
      messageCount: 1,
      topic,
      message: undefined,
      isDecodedProto: false,
      children,
      latestMessageTime: timestamp,
    };
    return mqttData;
  };

  const getSubtopicCount = (mqttData: MqttData) => {
    let subtopicCount = 0;
    for (const key in mqttData) {
      subtopicCount += 1;
    }
    return subtopicCount;
  };

  const getAllTopics = () => {
    const mqttData = get({ subscribe });
    const result = [] as string[];
    collectTopics(mqttData, result);
    return result;
  };

  const collectTopics = (data: MqttData, result: string[]) => {
    for (const topicLevel of Object.keys(data)) {
      const topicData = data[topicLevel];
      result.push(topicData.topic);
      collectTopics(topicData.children, result);
    }
  };

  const resetMqttData = () => {
    set({});
  };

  return { subscribe, getAllTopics, resetMqttData };
};
