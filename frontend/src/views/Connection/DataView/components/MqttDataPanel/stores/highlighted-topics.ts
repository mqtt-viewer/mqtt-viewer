import { writable } from "svelte/store";

export type HighlightCause = "child-update" | "message-update";

// Topic -> time ms last highlighted
type HighlightedMqttTopics = Map<
  string,
  {
    highlightAt: number;
    highlightFromMessageId: string;
    highlightCause: HighlightCause;
  }
>;

export type HighlightedMqttTopicsStore = ReturnType<
  typeof createHighlightedMqttTopicsStore
>;

export const createHighlightedMqttTopicsStore = () => {
  const { subscribe, set, update } = writable<HighlightedMqttTopics>(new Map());

  const markTopicForHighlight = (
    topic: string,
    messageId: string,
    highlightCause: HighlightCause
  ) => {
    update((highlightedMqttTopics) => {
      highlightedMqttTopics.set(topic, {
        highlightAt: Date.now(),
        highlightFromMessageId: messageId,
        highlightCause,
      });
      return highlightedMqttTopics;
    });
  };

  return {
    subscribe,
    markTopicForHighlight,
  };
};
