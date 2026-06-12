import {
  GetPublishHistoriesForConnection,
  SavePublishHistoryEntry,
  DeletePublishHistoryEntry,
  PublishMqtt,
} from "wailsjs/go/app/App";
import { get, writable } from "svelte/store";
import { app, models, mqtt } from "wailsjs/go/models";

import type { DeepOmit } from "@/util/types";
import {
  encodePayload,
  type SupportedCodeEditorCodec,
} from "@/components/CodeEditor/codec";
import type { SupportedCodeEditorFormat } from "@/components/CodeEditor/formatting";
import { emptyConvertValues } from "@/util/convertValues";
import { getContext, setContext } from "svelte";

export interface PublishDetails {
  connectionId: number;
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  properties: Omit<app.PublishProperties, "userProperties">;
  userPropertiesArray: { key: string; value: string }[];
  codec: SupportedCodeEditorCodec;
  format: SupportedCodeEditorFormat;
  // Used to signal a call to set the contents of the editor
  // from payload instead of the usual reverse
  forceEditorTextSetIncrement: number;
  hasAttemptedPublish: boolean;
  topicError: string | null;
  // Set when the editor holds a scratch copy of a saved collection message.
  // baseline is a snapshot of the saved state used for dirty detection.
  sourceMessageId: number | null;
  sourceMessageName: string | null;
  sourceCollectionId: number | null;
  baseline: string | null;
}

// The fields that count towards "Modified (unsaved)" for a saved message.
export const snapshotPublishDetails = (
  details: Pick<
    PublishDetails,
    | "topic"
    | "payload"
    | "qos"
    | "retain"
    | "codec"
    | "format"
    | "properties"
    | "userPropertiesArray"
  >
) => {
  return JSON.stringify({
    topic: details.topic,
    payload: details.payload,
    qos: details.qos,
    retain: details.retain,
    codec: details.codec,
    format: details.format,
    properties: details.properties,
    userProperties: details.userPropertiesArray.filter((p) => p.key !== ""),
  });
};

export type PublishDetailsStore = ReturnType<typeof createPublishStore>;

const contextKey = "publish-details";

export const getPublishStoreFromContext = () => {
  return getContext(contextKey) as PublishDetailsStore;
};

export const createPublishStore = (connId: number) => {
  const { subscribe, set, update } = writable<PublishDetails>({
    connectionId: connId,
    topic: "",
    payload: "{\n\n}",
    qos: 0,
    retain: false,
    properties: {
      payloadFormatIndicator: false,
      messageExpiryInterval: undefined,
      contentType: undefined,
      responseTopic: undefined,
      correlationData: undefined,
      subscriptionIdentifier: undefined,
      topicAlias: undefined,
    },
    userPropertiesArray: [],
    codec: "none",
    format: "none",
    forceEditorTextSetIncrement: 0,
    hasAttemptedPublish: false,
    topicError: null,
    sourceMessageId: null,
    sourceMessageName: null,
    sourceCollectionId: null,
    baseline: null,
  });

  const publish = async () => {
    try {
      const storeVals = {
        ...get({ subscribe }),
        convertValues: emptyConvertValues,
      };
      if (!storeVals.topic) {
        update((store) => {
          store.topicError = "Topic is required";
          return store;
        });
        return;
      }
      const codec = storeVals.codec;
      const encodedPayload = encodePayload(storeVals.payload, codec);
      update((store) => {
        store.topicError = null;
        return store;
      });
      const userProperties = getUserProperties();
      const toPublish = {
        ...storeVals,
        properties: { ...storeVals.properties, userProperties },
        payload: encodedPayload,
      };
      console.log("publishing", toPublish);
      await PublishMqtt(connId, toPublish);
    } catch (e) {
      throw e;
    }
  };

  const getUserProperties = () => {
    return get({ subscribe }).userPropertiesArray.reduce(
      (acc, { key, value }) => {
        if (key !== "") {
          acc[key] = value;
        }
        return acc;
      },
      {} as { [key: string]: string }
    );
  };

  const setPartial = (partial: Partial<PublishDetails>) => {
    update((store) => {
      if (partial.payload) {
        store.forceEditorTextSetIncrement++;
      }
      return { ...store, ...partial };
    });
    console.log("new store values", get({ subscribe }));
  };

  const formatPayload = () => {
    update((store) => {
      try {
        store.payload = JSON.stringify(JSON.parse(store.payload), null, 2);
      } catch (e) {
        console.error(e);
      }
      return store;
    });
  };

  // Loads a saved collection message into the editor as a scratch copy
  // (null = blank new message). Edits are not persisted until markSaved.
  const setSource = (message: models.CollectionMessage | null) => {
    if (!message) {
      setPartial({
        topic: "",
        payload: "{\n\n}",
        qos: 0,
        retain: false,
        properties: {
          payloadFormatIndicator: false,
          messageExpiryInterval: undefined,
          contentType: undefined,
          responseTopic: undefined,
          correlationData: undefined,
          subscriptionIdentifier: undefined,
          topicAlias: undefined,
        },
        userPropertiesArray: [],
        codec: "none",
        format: "none",
        hasAttemptedPublish: false,
        topicError: null,
        sourceMessageId: null,
        sourceMessageName: null,
        sourceCollectionId: null,
        baseline: null,
      });
      return;
    }

    let userPropertiesArray: { key: string; value: string }[] = [];
    if (message.userProperties) {
      try {
        userPropertiesArray = Object.entries(
          JSON.parse(message.userProperties)
        ).map(([key, value]) => ({ key, value: value as string }));
      } catch (e) {
        // no parseable properties
      }
    }
    const loaded: Partial<PublishDetails> = {
      topic: message.topic,
      payload: message.payload,
      qos: message.qos,
      retain: message.retain,
      codec: (message.encoding || "none") as SupportedCodeEditorCodec,
      format: (message.format || "none") as SupportedCodeEditorFormat,
      properties: {
        payloadFormatIndicator: !!message.headerPayloadFormatIndicator,
        messageExpiryInterval: message.headerMessageExpiryInterval,
        contentType: message.headerContentType,
        responseTopic: message.headerResponseTopic,
        correlationData: message.headerCorrelationData,
        subscriptionIdentifier: message.headerSubscriptionIdentifier,
        topicAlias: message.headerTopicAlias,
      },
      userPropertiesArray,
      hasAttemptedPublish: false,
      topicError: null,
      sourceMessageId: message.id,
      sourceMessageName: message.name,
      sourceCollectionId: message.collectionId,
    };
    setPartial({
      ...loaded,
      baseline: snapshotPublishDetails(loaded as PublishDetails),
    });
  };

  // Re-baselines after the scratch copy has been written back, or after a
  // new message has been saved into a collection.
  const markSaved = (saved: {
    id: number;
    name: string;
    collectionId: number;
  }) => {
    update((store) => {
      store.sourceMessageId = saved.id;
      store.sourceMessageName = saved.name;
      store.sourceCollectionId = saved.collectionId;
      store.baseline = snapshotPublishDetails(store);
      return store;
    });
  };

  const store = {
    subscribe,
    setPartial,
    set,
    getUserProperties,
    publish,
    formatPayload,
    setSource,
    markSaved,
  };

  setContext(contextKey, store);

  return store;
};
