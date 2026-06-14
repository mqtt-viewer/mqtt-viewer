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

  // Unsubscribe fns for the app-global event listeners; called by destroy()
  // so a torn-down store (e.g. a closed pop-out window) stops accumulating
  // history and leaking listeners on the shared backend event stream.
  let unsubscribers: Array<() => void> = [];

  const registerMessageListener = () => {
    const offMessages = Events.On(connectionEventSet.mqttMessages, (e) => {
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
    const offClear = Events.On(connectionEventSet.mqttClearHistory, () => {
      update((store) => {
        return { ...store, history: [], selectedTopic: null };
      });
    });
    unsubscribers = [offMessages, offClear];
  };

  // Tear down event listeners. Call when the owning surface unmounts (the
  // pop-out chart window in particular) so we don't leak a listener — and a
  // growing history buffer — on the shared, app-global backend event stream.
  const destroy = () => {
    for (const off of unsubscribers) off();
    unsubscribers = [];
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
    destroy,
  };
};
