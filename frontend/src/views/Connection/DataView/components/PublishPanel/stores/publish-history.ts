import {
  GetPublishHistoriesForConnection,
  SavePublishHistoryEntry,
  DeletePublishHistoryEntry,
} from "bindings/mqtt-viewer/backend/app/app";
import { writable } from "svelte/store";
import * as app from "bindings/mqtt-viewer/backend/app/models";
import * as models from "bindings/mqtt-viewer/backend/models/models";

import type { DeepOmit } from "@/util/types";
import type { PublishDetails, PublishDetailsStore } from "./publish-details";
import type { SupportedCodeEditorCodec } from "@/components/CodeEditor/codec";
import type { SupportedCodeEditorFormat } from "@/components/CodeEditor/formatting";

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
      setPublishDetailsFromHistoryEntry(publishHistories[0]);
    } catch (e) {
      console.error(e);
    }
  };

  const setPublishDetailsFromHistoryEntry = (entry: models.PublishHistory) => {
    console.log("setting publish details from history entry", entry);
    let firstUserProperties = {};
    if (!!entry.userProperties) {
      try {
        firstUserProperties = JSON.parse(entry.userProperties);
      } catch (e) {
        // Do nothing, no parseable properties
      }
    }

    const properties: app.PublishProperties = {
      payloadFormatIndicator: !!entry.headerPayloadFormatIndicator,
      messageExpiryInterval: entry.headerMessageExpiryInterval ?? undefined,
      contentType: entry.headerContentType ?? undefined,
      responseTopic: entry.headerResponseTopic ?? undefined,
      correlationData: entry.headerCorrelationData ?? undefined,
      subscriptionIdentifier: entry.headerSubscriptionIdentifier ?? undefined,
      topicAlias: entry.headerTopicAlias ?? undefined,
    };
    const userPropertiesArray = Object.entries(firstUserProperties).map(
      ([key, value]) => {
        return { key, value } as { key: string; value: string };
      }
    );
    const publishDetails: Partial<PublishDetails> = {
      connectionId: connId,
      topic: entry.topic,
      payload: entry.payload,
      qos: entry.qos,
      retain: entry.retain,
      properties: properties,
      codec: entry.encoding as SupportedCodeEditorCodec,
      format: entry.format as SupportedCodeEditorFormat,
      hasAttemptedPublish: true,
      topicError: null,
      userPropertiesArray,
    };
    console.log("built publish details", publishDetails);
    publishDetailsStore.setPartial(publishDetails);
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
        userProperties: userPropertiesString ?? null,
        headerContentType: params.properties?.contentType ?? null,
        headerPayloadFormatIndicator:
          params.properties?.payloadFormatIndicator ?? null,
        headerMessageExpiryInterval:
          params.properties?.messageExpiryInterval ?? null,
        headerResponseTopic: params.properties?.responseTopic ?? null,
        headerCorrelationData: params.properties?.correlationData ?? null,
        headerSubscriptionIdentifier:
          params.properties?.subscriptionIdentifier ?? null,
        headerTopicAlias: params.properties?.topicAlias ?? null,
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
