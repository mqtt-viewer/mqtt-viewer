import { writable } from "svelte/store";

type ExpandedMqttTopics = Set<string>;

export type ExpandedTopicsStore = ReturnType<typeof createExpandedTopicsStore>;

export const createExpandedTopicsStore = () => {
  const { subscribe, set, update } = writable<ExpandedMqttTopics>(new Set());

  const expandMqttTopic = (expandKey: string) => {
    update((expandedMqttTopics) => {
      expandedMqttTopics.add(expandKey);
      return expandedMqttTopics;
    });
  };

  const collapseMqttTopic = (expandKey: string) => {
    update((expandedMqttTopics) => {
      expandedMqttTopics.delete(expandKey);
      return expandedMqttTopics;
    });
  };

  const toggleMqttTopicExpansion = (expandKey: string) => {
    update((expandedMqttTopics) => {
      if (expandedMqttTopics.has(expandKey)) {
        expandedMqttTopics.delete(expandKey);
      } else {
        expandedMqttTopics.add(expandKey);
      }
      return expandedMqttTopics;
    });
  };

  const expandMultipleTopics = (expandKeys: string[]) => {
    update((store) => {
      const newSet = new Set(store);
      for (const key of expandKeys) {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const collapseMultipleTopics = (expandKeys: string[]) => {
    update((store) => {
      const newSet = new Set(store);
      for (const key of expandKeys) {
        newSet.delete(key);
      }
      return newSet;
    });
  };

  const collapseAllTopics = () => {
    set(new Set());
  };

  return {
    subscribe,
    expandMqttTopic,
    collapseMqttTopic,
    toggleMqttTopicExpansion,
    expandMultipleTopics,
    collapseMultipleTopics,
    collapseAllTopics,
  };
};
