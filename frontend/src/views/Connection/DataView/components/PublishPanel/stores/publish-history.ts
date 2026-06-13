import {
  GetPublishHistoriesForConnection,
  SavePublishHistoryEntry,
  DeletePublishHistoryEntry,
} from "wailsjs/go/app/App";
import { writable } from "svelte/store";
import { app, models } from "wailsjs/go/models";

import type { DeepOmit } from "@/util/types";
import {
  publishDetailsFromStoredMessage,
  type PublishDetailsStore,
} from "./publish-details";

export type PublishHistory = DeepOmit<models.PublishHistory, "convertValues">[];

interface PublishHistoryStore {
  publishHistory: PublishHistory;
}

export const createPublishHistoryStore = (
  connId: number,
  publishDetailsStore: PublishDetailsStore
) => {
  const { subscribe, set, update } = writable<PublishHistoryStore>(
    {
      publishHistory: [],
    },
    (set) => {
      loadConnectionPublishHistory();
    }
  );

  const loadConnectionPublishHistory = async () => {
    try {
      const publishHistories = await GetPublishHistoriesForConnection(connId);
      if (publishHistories.length === 0) {
        return;
      }
      // @ts-ignore
      set({ publishHistory: publishHistories });
    } catch (e) {
      console.error(e);
    }
  };

  const setPublishDetailsFromHistoryEntry = (entry: models.PublishHistory) => {
    publishDetailsStore.setPartial({
      ...publishDetailsFromStoredMessage(entry),
      connectionId: connId,
      hasAttemptedPublish: true,
    });
  };

  const savePublishEntry = async (params: {
    connectionId: number;
    topic: string;
    payload: string;
    qos: number;
    retain: boolean;
    encoding: string;
    format: string;
    properties?: app.PublishProperties;
    userProperties?: { [key: string]: string };
  }) => {
    try {
      console.log("saving publish entry", params);
      let userPropertiesString: undefined | string = undefined;
      if (!!params.userProperties) {
        try {
          userPropertiesString = JSON.stringify(params.userProperties);
        } catch (e) {
          console.error(e);
        }
      }
      const entry = await SavePublishHistoryEntry({
        connectionId: params.connectionId,
        topic: params.topic,
        payload: params.payload,
        qos: params.qos,
        retain: params.retain,
        encoding: params.encoding,
        format: params.format,
        userProperties: userPropertiesString,
        headerContentType: params.properties?.contentType,
        headerPayloadFormatIndicator: params.properties?.payloadFormatIndicator,
        headerMessageExpiryInterval: params.properties?.messageExpiryInterval,
        headerResponseTopic: params.properties?.responseTopic,
        headerCorrelationData: params.properties?.correlationData,
        headerSubscriptionIdentifier: params.properties?.subscriptionIdentifier,
        headerTopicAlias: params.properties?.topicAlias,
      });
      console.log("saved publish history entry", entry);
      update((store) => {
        //@ts-ignore - issue with omitting userProperties
        store.publishHistory = [entry, ...store.publishHistory];
        return store;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const deletePublishEntry = async (id: number) => {
    try {
      await DeletePublishHistoryEntry(id);
      update((store) => {
        store.publishHistory = store.publishHistory.filter((e) => e.id !== id);
        return store;
      });
    } catch (e) {
      throw e;
    }
  };

  return {
    subscribe,
    savePublishEntry,
    deletePublishEntry,
    setPublishDetailsFromHistoryEntry,
  };
};
