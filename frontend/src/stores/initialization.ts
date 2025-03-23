import { writable } from "svelte/store";
import _ from "lodash";
import connections from "./connections";
import os from "./env";
import connectionTabs from "./tabs";
import subscriptions from "./subscriptions";
import panelSizes from "./panel-sizes";
import defaultSorts from "./default-sorts";

interface InitializationStore {
  appIsReady: boolean;
}

const { subscribe, set } = writable<InitializationStore>({
  appIsReady: false,
});

const init = async () => {
  try {
    await Promise.all([
      os.init(),
      connections.init(),
      subscriptions.init(),
      connectionTabs.init(),
      panelSizes.init(),
      defaultSorts.init(),
    ]);
    set({
      appIsReady: true,
    });
  } catch (e) {
    console.error(e);
  }
};

export default {
  subscribe,
  init,
};
