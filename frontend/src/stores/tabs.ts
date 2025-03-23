import { get, writable } from "svelte/store";
import { LoadOpenTabs, UpdateOpenConnectionTabs } from "wailsjs/go/app/App";

export const MAX_OPEN_TABS = 10;

type ConnectionId = number;
export type Tab = ConnectionId | "home";

interface TabStore {
  tabs: number[];
  isMaxTabsReached: boolean;
  selectedTab: Tab;
  isNewTabSelected: boolean;
  isMaxOpenTabsDialogOpen: boolean;
}

const { subscribe, set, update } = writable<TabStore>(
  {
    tabs: [],
    isMaxTabsReached: false,
    selectedTab: "home",
    isNewTabSelected: false,
    isMaxOpenTabsDialogOpen: false,
  },
  (set) => {}
);

const init = async () => {
  try {
    let tabs = await LoadOpenTabs();
    set({
      tabs: tabs.map((tab) => tab.connectionId),
      isMaxTabsReached: tabs.length >= MAX_OPEN_TABS,
      selectedTab: "home",
      isNewTabSelected: false,
      isMaxOpenTabsDialogOpen: false,
    });
  } catch (e) {
    console.error(e);
  }
};

const updateTabIndexes = async (connectionIds: number[]) => {
  console.log("updateTabIndexes", connectionIds);
  update((store) => {
    return {
      ...store,
      tabs: connectionIds,
    };
  });
  await UpdateOpenConnectionTabs(connectionIds);
};

const selectTab = (tab: Tab) => {
  const currentTab = get({ subscribe }).selectedTab;
  const isNewTabSelected = get({ subscribe }).isNewTabSelected;
  if (isNewTabSelected) {
    deselectNewTab();
  }
  if (currentTab === tab) return;
  if (typeof tab === "number" && !get({ subscribe }).tabs.includes(tab)) {
    addTab(tab);
    return;
  }
  update((store) => {
    console.log("selecting specific tab", tab, store);
    return {
      ...store,
      selectedTab: tab,
      isNewTabSelected: false,
    };
  });
};

const selectNewTab = () => {
  update((store) => {
    console.log("selecting new tab", store);
    return {
      ...store,
      isNewTabSelected: true,
    };
  });
};

const deselectNewTab = () => {
  update((store) => {
    console.log("deselecting new tab", store);
    return {
      ...store,
      isNewTabSelected: false,
    };
  });
};

const addTab = async (connectionId: number) => {
  if (get({ subscribe }).tabs.length >= MAX_OPEN_TABS) {
    update((store) => {
      return {
        ...store,
        isMaxOpenTabsDialogOpen: true,
        isMaxTabsReached: true,
      };
    });
    return;
  }
  const newTabs = get({ subscribe }).tabs.concat(connectionId);
  update((store) => {
    return {
      ...store,
      isNewTabSelected: false,
      selectedTab: connectionId,
      tabs: newTabs,
      isMaxTabsReached: newTabs.length >= MAX_OPEN_TABS,
    };
  });
  UpdateOpenConnectionTabs(newTabs);
};

const closeTab = async (connectionId: number) => {
  const currentTab = get({ subscribe }).selectedTab;
  const newTabs = get({ subscribe }).tabs.filter((tab) => tab !== connectionId);
  if (currentTab === connectionId) {
    update((store) => {
      return {
        ...store,
        tabs: newTabs,
        selectedTab: "home",
        isMaxTabsReached: newTabs.length >= MAX_OPEN_TABS,
      };
    });
  } else {
    update((store) => {
      return {
        ...store,
        tabs: newTabs,
        isMaxTabsReached: newTabs.length >= MAX_OPEN_TABS,
      };
    });
  }
  UpdateOpenConnectionTabs(newTabs);
  return newTabs;
};

const closeMaxOpenTabsDialog = () => {
  update((store) => {
    return {
      ...store,
      isMaxOpenTabsDialogOpen: false,
    };
  });
};

export default {
  subscribe,
  init,
  selectTab,
  updateTabIndexes,
  addTab,
  closeTab,
  selectNewTab,
  deselectNewTab,
  closeMaxOpenTabsDialog,
};
