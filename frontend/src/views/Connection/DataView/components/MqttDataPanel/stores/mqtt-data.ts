import { get, writable } from "svelte/store";
import type * as events from "bindings/mqtt-viewer/events/models";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import { Events } from "@wailsio/runtime";
import { base64ToUtf8 } from "@/components/CodeEditor/codec";
import type {
  HighlightCause,
  HighlightedMqttTopicsStore,
} from "./highlighted-topics";

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
  const { subscribe, set, update } = writable<MqttData>({}, () => {
    if (eventSet === undefined) return;
    // Capture the unsubscribe handles and tear them down when the last store
    // subscriber leaves, so listeners don't accumulate across tab churn.
    const offMessages = Events.On(eventSet.mqttMessages, (e: any) => {
      const messages: mqtt.MqttMessage[] = e.data;
      processMessages(messages);
    });
    const offClear = Events.On(eventSet.mqttClearHistory, () => {
      resetMqttData();
    });
    return () => {
      offMessages?.();
      offClear?.();
    };
  });

  // A batch may carry many messages for the same topic (e.g. a busy sensor
  // publishing at high frequency within one 300ms drain). Only the last
  // message per topic ends up in the tree, so decoding/timestamping every
  // message is wasted work — collapse the batch to one entry per topic first,
  // keeping a running count so messageCount still reflects every message.
  const processMessages = (messages: mqtt.MqttMessage[]) => {
    const latestByTopic = new Map<
      string,
      { last: mqtt.MqttMessage; count: number }
    >();
    for (const message of messages) {
      const existing = latestByTopic.get(message.topic);
      if (existing === undefined) {
        latestByTopic.set(message.topic, { last: message, count: 1 });
      } else {
        existing.last = message;
        existing.count += 1;
      }
    }

    const highlightMarks: Array<{
      topic: string;
      messageId: string;
      cause: HighlightCause;
    }> = [];

    update((mqttData) => {
      for (const { last: message, count } of latestByTopic.values()) {
        const topicLevels = message.topic.split("/");
        const timestamp = new Date(message.timeMs);
        const decodedMessage = base64ToUtf8(
          message.payload as unknown as string
        );
        const isDecodedProto = message?.middlewareProperties?.IsDecodedProto;

        let prefix = "";
        for (let i = 0; i < topicLevels.length; i++) {
          prefix = i === 0 ? topicLevels[0] : `${prefix}/${topicLevels[i]}`;
          highlightMarks.push({
            topic: prefix,
            messageId: message.id,
            cause:
              i !== topicLevels.length - 1 ? "child-update" : "message-update",
          });
        }

        insertMqttMessage(
          mqttData,
          topicLevels,
          0,
          decodedMessage,
          isDecodedProto,
          timestamp,
          count
        );
      }
      return mqttData;
    });

    highlightedTopicStore.markTopicsForHighlight(highlightMarks);
  };

  // Returns true when a new topic-level key was created in mqttData, so the
  // caller can maintain subtopicCount (the number of direct child keys) by
  // incrementing it, instead of rescanning every sibling on each insert —
  // that scan is O(siblings) and made wide subtrees quadratic per batch.
  const insertMqttMessage = (
    mqttData: MqttData,
    topicLevels: string[],
    currentTopicLevel: number,
    message: string,
    isDecodedProto: boolean,
    timestamp: Date,
    count: number
  ): boolean => {
    const topicLevel = topicLevels[currentTopicLevel];
    if (mqttData[topicLevel] !== undefined) {
      if (currentTopicLevel === topicLevels.length - 1) {
        mqttData[topicLevel].messageCount += count;
        mqttData[topicLevel].message = message;
        mqttData[topicLevel].isDecodedProto = isDecodedProto;
        mqttData[topicLevel].latestMessageTime = timestamp;

        return false;
      }
      const createdChild = insertMqttMessage(
        mqttData[topicLevel].children,
        topicLevels,
        currentTopicLevel + 1,
        message,
        isDecodedProto,
        timestamp,
        count
      );
      mqttData[topicLevel].isDecodedProto = isDecodedProto;
      mqttData[topicLevel].messageCount += count;
      if (createdChild) {
        mqttData[topicLevel].subtopicCount += 1;
      }
      mqttData[topicLevel].latestMessageTime = timestamp;
      return false;
    }

    if (currentTopicLevel === topicLevels.length - 1) {
      const topic = topicLevels.join("/");
      mqttData[topicLevel] = {
        subtopicCount: 0,
        messageCount: count,
        topic,
        isDecodedProto,
        message,
        children: {},
        latestMessageTime: timestamp,
      };
      return true;
    }

    const children: MqttData = {};
    insertMqttMessage(
      children,
      topicLevels,
      currentTopicLevel + 1,
      message,
      false,
      timestamp,
      count
    );
    const topic = topicLevels.slice(0, currentTopicLevel + 1).join("/");
    mqttData[topicLevel] = {
      // The recursive call above created exactly one child key.
      subtopicCount: 1,
      messageCount: count,
      topic,
      message: undefined,
      isDecodedProto: false,
      children,
      latestMessageTime: timestamp,
    };
    return true;
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
