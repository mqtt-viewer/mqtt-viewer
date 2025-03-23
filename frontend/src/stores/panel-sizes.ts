import { get, writable } from "svelte/store";
import { GetPanelSizes, UpdatePanelSize } from "wailsjs/go/app/App";
import { WindowGetSize } from "wailsjs/runtime/runtime";

type SizePx = number;

interface PanelSizes {
  rootWindowWidth: SizePx;
  rootWindowHeight: SizePx;
  resizablePanelSizes: {
    [panelId: string]: {
      size: SizePx;
      isOpen: boolean;
    };
  };
}

const { subscribe, set, update } = writable<PanelSizes>({
  rootWindowHeight: 0,
  rootWindowWidth: 0,
  resizablePanelSizes: {},
});

const init = async () => {
  try {
    const windowSize = await WindowGetSize();
    const panelSizes = await GetPanelSizes();
    const resizablePanelSizes: {
      [id: string]: {
        size: SizePx;
        isOpen: boolean;
      };
    } = {};
    for (const panelSize of panelSizes) {
      resizablePanelSizes[panelSize.id] = {
        size: panelSize.size,
        isOpen: panelSize.isOpen,
      };
    }
    set({
      rootWindowHeight: windowSize.h,
      rootWindowWidth: windowSize.w,
      resizablePanelSizes,
    });
  } catch (e) {
    console.error(e);
  }
};

const updatePanelSize = (panelId: string, size: SizePx, isOpen: boolean) => {
  try {
    UpdatePanelSize(panelId, Math.round(size), isOpen);
    update((store) => {
      store.resizablePanelSizes[panelId] = {
        size: Math.round(size),
        isOpen,
      };
      return store;
    });
  } catch (e) {
    console.error(e);
  }
};

const updateAppWidth = (width: SizePx) => {
  update((store) => {
    store.rootWindowWidth = width;
    return store;
  });
};

export default {
  subscribe,
  init,
  updatePanelSize,
  updateAppWidth,
};
