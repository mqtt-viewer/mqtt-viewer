import { writable, get } from "svelte/store";
import { GetMatchingSubscriptionForTopic } from "bindings/mqtt-viewer/backend/app/app";
import type * as models from "bindings/mqtt-viewer/backend/models/models";
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
    // No prototype: the keys are topics, and "toString" or "constructor"
    // must not read as an already cached match.
    topics: Object.create(null),
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
      store.topics = Object.create(null);
      return store;
    });
  };

  return {
    subscribe,
    clearCache,
    getTopicMatch,
  };
};
