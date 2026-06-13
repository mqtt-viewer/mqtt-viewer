import { get, writable } from "svelte/store";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import { GetMessageHistory } from "bindings/mqtt-viewer/backend/app/app";
import { Events } from "@wailsio/runtime";
import type * as events from "bindings/mqtt-viewer/events/models";
import {
  base64ToUtf8,
  type SupportedCodeEditorCodec,
} from "@/components/CodeEditor/codec";
import type { SupportedCodeEditorFormat } from "@/components/CodeEditor/formatting";

export type MqttHistoryMessage = Omit<
  mqtt.MqttMessage,
  "payload" | "convertValues"
> & {
  payload: string;
};

interface SelectedTopicData {
  connectionId: number;
  connectionEventSet: events.ConnectionEventsSet;
  selectedTopic: string | null;
  history: MqttHistoryMessage[];
  options: {
    autoSelect: boolean;
    compare: boolean;
    decoding: SupportedCodeEditorCodec;
    format: SupportedCodeEditorFormat;
  };
  onNewMessages: null | ((messages: MqttHistoryMessage[]) => void);
}

export type SelectedTopicStore = ReturnType<typeof createSelectedTopicStore>;

export const createSelectedTopicStore = (
  connectionId: number,
  connectionEventSet: events.ConnectionEventsSet
) => {
  const { subscribe, set, update } = writable<SelectedTopicData>(
    {
      connectionId,
      connectionEventSet,
      selectedTopic: null,
      history: [],
      onNewMessages: null,
      options: {
        autoSelect: true,
        compare: false,
        decoding: "none",
        format: "none",
      },
    },
    (set) => {
      registerMessageListener();
    }
  );

  const registerMessageListener = () => {
    Events.On(connectionEventSet.mqttMessages, (e) => {
      const messages: mqtt.MqttMessage[] = e.data;
      const { selectedTopic, onNewMessages } = get({ subscribe });
      if (selectedTopic === null) return;
      const newMessagesForSelectedTopic = messages.filter(
        (m) => m.topic === selectedTopic
      );
      if (newMessagesForSelectedTopic.length > 0) {
        const decodedNewMessages = newMessagesForSelectedTopic.map((m) => {
          return {
            ...m,
            payload: base64ToUtf8(m.payload as unknown as string),
          };
        });
        if (onNewMessages !== null) {
          onNewMessages(decodedNewMessages);
        }
        update((store) => {
          return {
            ...store,
            history: [...store.history, ...decodedNewMessages],
          };
        });
      }
    });
    Events.On(connectionEventSet.mqttClearHistory, () => {
      update((store) => {
        return { ...store, history: [], selectedTopic: null };
      });
    });
  };

  const selectTopic = async (
    topic: string,
    onNewMessages?: (messages: MqttHistoryMessage[]) => void
  ) => {
    const { connectionId } = get({ subscribe });
    const history = await GetMessageHistory(connectionId, topic);
    const decocdedHistory = history.map((m) => {
      return {
        ...m,
        payload: base64ToUtf8(m.payload as unknown as string),
      };
    });
    update((store) => {
      return {
        ...store,
        selectedTopic: topic,
        history: decocdedHistory,
        options: {
          autoSelect: true,
          compare: store.options.compare,
          decoding: store.options.decoding,
          format: store.options.format,
        },
        onNewMessages: onNewMessages ?? null,
      };
    });
  };

  const deselectTopic = () => {
    update((store) => {
      return {
        ...store,
        selectedTopic: null,
        history: [],
        onNewMessages: null,
      };
    });
  };

  const setOnNewMessages = (
    onNewMessages: null | ((messages: MqttHistoryMessage[]) => void)
  ) => {
    update((store) => {
      return { ...store, onNewMessages };
    });
  };

  const setComparing = (compare: boolean) => {
    update((store) => {
      return {
        ...store,
        options: {
          autoSelect: store.options.autoSelect,
          compare,
          decoding: store.options.decoding,
          format: store.options.format,
        },
      };
    });
  };

  const setAutoSelect = (autoSelect: boolean) => {
    update((store) => {
      return {
        ...store,
        options: {
          autoSelect,
          compare: store.options.compare,
          decoding: store.options.decoding,
          format: store.options.format,
        },
      };
    });
  };

  return {
    set,
    subscribe,
    selectTopic,
    deselectTopic,
    setOnNewMessages,
    setComparing,
    setAutoSelect,
  };
};
