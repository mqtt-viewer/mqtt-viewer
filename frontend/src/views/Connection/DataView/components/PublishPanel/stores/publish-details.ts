import {
  GetPublishHistoriesForConnection,
  SavePublishHistoryEntry,
  DeletePublishHistoryEntry,
  PublishMqtt,
} from "bindings/mqtt-viewer/backend/app/app";
import { get, writable } from "svelte/store";
import * as app from "bindings/mqtt-viewer/backend/app/models";
import * as models from "bindings/mqtt-viewer/backend/models/models";
import * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";

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
  // 'auto' (matcher/sparkplug decide), 'none' (raw, no protobuf), or a
  // message type name (forced). Maps to PublishParams.protoOverride at the
  // PublishMqtt boundary: auto -> null, none -> "", type -> name.
  protoOverrideChoice: string;
}

// Flat record shape shared by publish history entries and collection messages.
export interface StoredPublishMessage {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  encoding: string;
  format: string;
  userProperties?: string | null;
  headerContentType?: string | null;
  headerResponseTopic?: string | null;
  headerCorrelationData?: string | null;
  headerPayloadFormatIndicator?: boolean | null;
  headerMessageExpiryInterval?: number | null;
  headerTopicAlias?: number | null;
  headerSubscriptionIdentifier?: number | null;
  protoOverride?: string | null;
}

// Single mapper from a stored message (history entry or collection message)
// to editor fields — keep history and collections loading in lockstep.
export const publishDetailsFromStoredMessage = (
  message: StoredPublishMessage
): Partial<PublishDetails> => {
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
  return {
    topic: message.topic,
    payload: message.payload,
    qos: message.qos,
    retain: message.retain,
    codec: (message.encoding || "none") as SupportedCodeEditorCodec,
    format: (message.format || "none") as SupportedCodeEditorFormat,
    properties: {
      payloadFormatIndicator: !!message.headerPayloadFormatIndicator,
      messageExpiryInterval: message.headerMessageExpiryInterval ?? undefined,
      contentType: message.headerContentType ?? undefined,
      responseTopic: message.headerResponseTopic ?? undefined,
      correlationData: message.headerCorrelationData ?? undefined,
      subscriptionIdentifier: message.headerSubscriptionIdentifier ?? undefined,
      topicAlias: message.headerTopicAlias ?? undefined,
    },
    userPropertiesArray,
    topicError: null,
    protoOverrideChoice: protoOverrideChoiceFromStored(message.protoOverride),
  };
};

// Stored protoOverride -> editor choice: null/undefined = auto, "" = raw,
// anything else = that message type.
export const protoOverrideChoiceFromStored = (
  protoOverride?: string | null
): string => {
  if (protoOverride === undefined || protoOverride === null) return "auto";
  if (protoOverride === "") return "none";
  return protoOverride;
};

// Editor choice -> PublishParams.protoOverride / stored protoOverride.
export const protoOverrideParamFromChoice = (choice: string): string | null => {
  if (choice === "auto") return null;
  if (choice === "none") return "";
  return choice;
};

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
    | "protoOverrideChoice"
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
    protoOverride: details.protoOverrideChoice,
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
    protoOverrideChoice: "auto",
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
        protoOverride: protoOverrideParamFromChoice(
          storeVals.protoOverrideChoice
        ),
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

  // Topic EDITS reset the override to auto (the old choice may not make
  // sense for the new topic). Loads of saved/history messages must NOT use
  // this: they restore topic and protoOverrideChoice together via
  // setPartial/setSource, so the persisted choice survives the load.
  const setTopic = (topic: string) => {
    update((store) => ({ ...store, topic, protoOverrideChoice: "auto" }));
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

  const blankDetails: Partial<PublishDetails> = {
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
    topicError: null,
    protoOverrideChoice: "auto",
  };

  // Loads a saved collection message into the editor as a scratch copy
  // (null = blank new message). Edits are not persisted until markSaved.
  const setSource = (message: models.CollectionMessage | null) => {
    const loaded: Partial<PublishDetails> = message
      ? {
          ...publishDetailsFromStoredMessage(message),
          sourceMessageId: message.id,
          sourceMessageName: message.name,
          sourceCollectionId: message.collectionId,
        }
      : {
          ...blankDetails,
          sourceMessageId: null,
          sourceMessageName: null,
          sourceCollectionId: null,
        };
    loaded.baseline = message
      ? snapshotPublishDetails(loaded as PublishDetails)
      : null;
    update((store) => ({
      ...store,
      ...loaded,
      hasAttemptedPublish: false,
      // always refresh the editor, even when the loaded payload is empty
      forceEditorTextSetIncrement: store.forceEditorTextSetIncrement + 1,
    }));
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
    setTopic,
    getUserProperties,
    publish,
    formatPayload,
    setSource,
    markSaved,
  };

  setContext(contextKey, store);

  return store;
};
