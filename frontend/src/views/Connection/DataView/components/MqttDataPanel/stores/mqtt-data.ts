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
    // Whether this topic currently holds a retained message, as far as we
    // know. Mirrors the backend's retained index (see mqtt.MessageHistory) so
    // the tree can show a retained marker without a binding call per row. The
    // backend is authoritative for counting and clearing; this is for display.
    isRetained: boolean;
    children: MqttData;
  };
};

export type MqttDataStore = ReturnType<typeof createMqttDataStore>;

/**
 * What a message says about its topic's retained state, mirroring the rule the
 * backend applies (see mqtt.MessageHistory's retained field):
 * a retained message with a payload means the topic holds a retained value, a
 * retained zero-length payload is the MQTT tombstone that clears one, and a
 * non-retained message says nothing either way.
 *
 * Returns undefined for "no change".
 */
export const retainedStateOf = (
  message: mqtt.MqttMessage
): boolean | undefined => {
  if (!message.retain) return undefined;
  // payload crosses the bridge base64-encoded, so an empty string is a
  // zero-length payload.
  const payload = (message.payload as unknown as string) ?? "";
  return payload.length > 0;
};

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
      { last: mqtt.MqttMessage; count: number; retained?: boolean }
    >();
    for (const message of messages) {
      const existing = latestByTopic.get(message.topic);
      if (existing === undefined) {
        latestByTopic.set(message.topic, {
          last: message,
          count: 1,
          retained: retainedStateOf(message),
        });
      } else {
        existing.last = message;
        existing.count += 1;
        // Retained state is tracked across the whole batch rather than taken
        // from the last message, because collapsing to the last message would
        // lose a state change: a retained tombstone followed by ordinary
        // traffic on the same topic within one drain would leave the topic
        // still marked retained.
        const retained = retainedStateOf(message);
        if (retained !== undefined) existing.retained = retained;
      }
    }

    const highlightMarks: Array<{
      topic: string;
      messageId: string;
      cause: HighlightCause;
    }> = [];

    update((mqttData) => {
      for (const { last: message, count, retained } of latestByTopic.values()) {
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
          count,
          retained
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
    count: number,
    // undefined means "this message says nothing about retained state"; only
    // the topic the message was published to is affected, never its ancestors.
    retained: boolean | undefined
  ): boolean => {
    const topicLevel = topicLevels[currentTopicLevel];
    if (mqttData[topicLevel] !== undefined) {
      if (currentTopicLevel === topicLevels.length - 1) {
        mqttData[topicLevel].messageCount += count;
        mqttData[topicLevel].message = message;
        mqttData[topicLevel].isDecodedProto = isDecodedProto;
        mqttData[topicLevel].latestMessageTime = timestamp;
        if (retained !== undefined) {
          mqttData[topicLevel].isRetained = retained;
        }

        return false;
      }
      const createdChild = insertMqttMessage(
        mqttData[topicLevel].children,
        topicLevels,
        currentTopicLevel + 1,
        message,
        isDecodedProto,
        timestamp,
        count,
        retained
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
        isRetained: retained ?? false,
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
      count,
      retained
    );
    const topic = topicLevels.slice(0, currentTopicLevel + 1).join("/");
    mqttData[topicLevel] = {
      // The recursive call above created exactly one child key.
      subtopicCount: 1,
      messageCount: count,
      topic,
      message: undefined,
      isDecodedProto: false,
      // An intermediate level is not the topic the message was published to,
      // so it holds no retained value of its own.
      isRetained: false,
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
