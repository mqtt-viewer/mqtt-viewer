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

  // Applies every mark from a batch in a single update, so a batch of
  // thousands of messages produces one store notification instead of one
  // per topic level per message.
  const markTopicsForHighlight = (
    marks: Array<{ topic: string; messageId: string; cause: HighlightCause }>
  ) => {
    if (marks.length === 0) return;
    update((highlightedMqttTopics) => {
      const highlightAt = Date.now();
      for (const mark of marks) {
        highlightedMqttTopics.set(mark.topic, {
          highlightAt,
          highlightFromMessageId: mark.messageId,
          highlightCause: mark.cause,
        });
      }
      return highlightedMqttTopics;
    });
  };

  return {
    subscribe,
    markTopicsForHighlight,
  };
};
