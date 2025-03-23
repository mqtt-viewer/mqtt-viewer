import { writable, get } from "svelte/store";
import { GetMatchingSubscriptionForTopic } from "wailsjs/go/app/App";
import type { models } from "wailsjs/go/models";
type Topic = string;

interface MatchedTopicsStore {
  connectionId: number;
  topics: {
    [topic: Topic]: models.Subscription | null | undefined;
  };
}

export const createMatchedTopicsStore = (connId: number) => {
  const { subscribe, set, update } = writable<MatchedTopicsStore>({
    connectionId: connId,
    topics: {},
  });

  const getTopicMatch = async (topic: string) => {
    const { connectionId, topics } = get({ subscribe });
    const existing = topics[topic];
    if (existing !== undefined) {
      return existing;
    }
    const matchingTopic = await GetMatchingSubscriptionForTopic(
      connectionId,
      topic
    );
    let result: models.Subscription | null = null;
    if (matchingTopic !== null) result = matchingTopic;
    update((store) => {
      store.topics[topic] = result;
      return store;
    });
    return result;
  };

  const clearCache = () => {
    update((store) => {
      store.topics = {};
      return store;
    });
  };

  return {
    subscribe,
    clearCache,
    getTopicProtoDescriptorMatch: getTopicMatch,
  };
};
