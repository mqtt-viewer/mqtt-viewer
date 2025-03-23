import {
  AddSubscription,
  DeleteSubscription,
  GetAllSubscriptionsByConnectionId,
  UpdateSubscription,
} from "wailsjs/go/app/App";
import { get, writable } from "svelte/store";
import type { models } from "wailsjs/go/models";
import type { DeepOmit } from "@/util/types";
import { debounce } from "lodash";

type SubscriptionWithOptionalQos = DeepOmit<
  models.Subscription,
  "convertValues"
>;
export type Subscription = SubscriptionWithOptionalQos & { qos: number };
interface SubscriptionStore {
  subscriptionsByConnectionId: {
    [connId: number]: Subscription[];
  };
}

const { subscribe, set, update } = writable<SubscriptionStore>({
  subscriptionsByConnectionId: {},
});

const init = async () => {
  try {
    let subscriptionsByConnectionId =
      (await GetAllSubscriptionsByConnectionId()) as SubscriptionStore["subscriptionsByConnectionId"];
    set({
      subscriptionsByConnectionId,
    });
  } catch (e) {
    console.error(e);
  }
};

const addNewConnectionSubRecords = (
  connId: number,
  subscriptions: Subscription[]
) => {
  update((store) => {
    store.subscriptionsByConnectionId[connId] = subscriptions;
    return store;
  });
};

const addSubscription = async (
  connId: number,
  beforeStoreUpdate?: () => void
) => {
  try {
    const newSub = (await AddSubscription(connId)) as Subscription;
    const existingSubs =
      get({ subscribe }).subscriptionsByConnectionId[connId] ?? [];
    const newSubs = [...existingSubs, newSub];
    if (beforeStoreUpdate) {
      beforeStoreUpdate();
    }
    update((store) => {
      store.subscriptionsByConnectionId[connId] = newSubs;
      return store;
    });
    return newSub;
  } catch (e) {
    throw e;
  }
};

const deleteSubscription = async (connId: number, subId: number) => {
  try {
    await DeleteSubscription(connId, subId);
    const existingSubs = get({ subscribe }).subscriptionsByConnectionId[connId];
    const newSubs = existingSubs.filter((sub) => sub.id !== subId);
    update((store) => {
      store.subscriptionsByConnectionId[connId] = newSubs;
      return store;
    });
  } catch (e) {
    throw e;
  }
};

const removeConnection = async (connId: number) => {
  try {
    update((store) => {
      delete store.subscriptionsByConnectionId[connId];
      return store;
    });
  } catch (e) {
    throw e;
  }
};

const debouncedUpdateSubscription = debounce(UpdateSubscription, 400);

const updateSubscription = async (
  connId: number,
  subscription: Subscription
) => {
  try {
    debouncedUpdateSubscription(connId, subscription as models.Subscription);
    let newSubs = [] as Subscription[];
    const existingSubs = get({ subscribe }).subscriptionsByConnectionId[connId];
    if (!existingSubs) {
      newSubs = [subscription];
    } else {
      const existingSubIndex = existingSubs.findIndex(
        (sub) => sub.id === subscription.id
      );
      if (existingSubIndex !== -1) {
        newSubs = [...existingSubs];
        newSubs[existingSubIndex] = subscription;
      } else {
        newSubs = [...existingSubs, subscription];
      }
    }
    update((store) => {
      store.subscriptionsByConnectionId[connId] = newSubs;
      return store;
    });
  } catch (e) {
    throw e;
  }
};

export default {
  subscribe,
  init,
  addNewConnectionSubRecords,
  addSubscription,
  deleteSubscription,
  updateSubscription,
  removeConnection,
};
