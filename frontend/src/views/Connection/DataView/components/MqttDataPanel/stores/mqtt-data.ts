import { get, writable } from "svelte/store";
import type * as events from "bindings/mqtt-viewer/events/models";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import { Events } from "@wailsio/runtime";
import { base64ToUtf8 } from "@/components/CodeEditor/codec";
import type { HighlightedMqttTopicsStore } from "./highlighted-topics";

export type MqttData = {
  [topicLevel: string]: {
    subtopicCount: number;
    messageCount: number;
    topic: string;
    latestMessageTime: Date;
    message?: string; // byte array
    protoDecode?: "ok" | "failed";
    protoDescriptorName?: string;
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
      const decodedMessage = base64ToUtf8(message.payload as unknown as string);
      const { protoDecode, protoDescriptorName } =
        readProtoDecodeStatus(message);
      update((mqttData) => {
        return insertMqttMessage(
          mqttData,
          topicLevels,
          0,
          decodedMessage,
          protoDecode,
          protoDescriptorName,
          timestamp
        );
      });
    }
  };

  // Reads the middleware's decode marker, with a legacy fallback for
  // messages recorded before ProtoDecode/ProtoDescriptorName existed.
  const readProtoDecodeStatus = (
    message: mqtt.MqttMessage
  ): { protoDecode?: "ok" | "failed"; protoDescriptorName?: string } => {
    const mw = message?.middlewareProperties as
      | Record<string, unknown>
      | undefined;
    if (mw?.ProtoDecode === "ok" || mw?.ProtoDecode === "failed") {
      return {
        protoDecode: mw.ProtoDecode,
        protoDescriptorName: mw.ProtoDescriptorName as string | undefined,
      };
    }
    if (mw?.IsDecodedProto === true) {
      return { protoDecode: "ok" };
    }
    return {};
  };

  const insertMqttMessage = (
    mqttData: MqttData,
    topicLevels: string[],
    currentTopicLevel: number,
    message: string,
    protoDecode: "ok" | "failed" | undefined,
    protoDescriptorName: string | undefined,
    timestamp: Date
  ) => {
    const topicLevel = topicLevels[currentTopicLevel];
    if (mqttData[topicLevel] !== undefined) {
      if (currentTopicLevel === topicLevels.length - 1) {
        mqttData[topicLevel].messageCount += 1;
        mqttData[topicLevel].message = message;
        mqttData[topicLevel].protoDecode = protoDecode;
        mqttData[topicLevel].protoDescriptorName = protoDescriptorName;
        mqttData[topicLevel].latestMessageTime = timestamp;

        return mqttData;
      }
      const children = insertMqttMessage(
        mqttData[topicLevel].children,
        topicLevels,
        currentTopicLevel + 1,
        message,
        protoDecode,
        protoDescriptorName,
        timestamp
      );
      // Ancestors only ever pick up "ok": a failed leaf below must not paint
      // a warning over the whole subtree, and must not clobber an existing
      // "ok" left by another message under this branch.
      if (protoDecode === "ok") {
        mqttData[topicLevel].protoDecode = "ok";
        mqttData[topicLevel].protoDescriptorName = protoDescriptorName;
      }
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
        protoDecode,
        protoDescriptorName,
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
      protoDecode,
      protoDescriptorName,
      timestamp
    );
    const topic = topicLevels.slice(0, currentTopicLevel + 1).join("/");
    mqttData[topicLevel] = {
      subtopicCount: getSubtopicCount(children),
      messageCount: 1,
      topic,
      message: undefined,
      protoDecode: protoDecode === "ok" ? "ok" : undefined,
      protoDescriptorName:
        protoDecode === "ok" ? protoDescriptorName : undefined,
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
