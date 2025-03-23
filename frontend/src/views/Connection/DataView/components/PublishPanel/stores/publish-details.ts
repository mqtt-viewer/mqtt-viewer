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
  type SupportCodeEditorCodec,
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
  codec: SupportCodeEditorCodec;
  format: SupportedCodeEditorFormat;
  // Used to signal a call to set the contents of the editor
  // from payload instead of the usual reverse
  forceEditorTextSetIncrement: number;
  hasAttemptedPublish: boolean;
  topicError: string | null;
}

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

  const store = {
    subscribe,
    setPartial,
    set,
    getUserProperties,
    publish,
    formatPayload,
  };

  setContext(contextKey, store);

  return store;
};
