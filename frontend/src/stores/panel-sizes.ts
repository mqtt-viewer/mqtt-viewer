import { get, writable } from "svelte/store";
import { GetPanelSizes, UpdatePanelSize } from "bindings/mqtt-viewer/backend/app/app";
import { Window } from "@wailsio/runtime";

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
  // Window.Size() is a native call: in server mode it is a no-op that either
  // rejects or answers 0x0. It gets its own try/catch so a failure here cannot
  // skip GetPanelSizes below and leave every panel at its default size.
  let rootWindowWidth = 0;
  let rootWindowHeight = 0;
  try {
    const windowSize = await Window.Size();
    rootWindowWidth = windowSize.width;
    rootWindowHeight = windowSize.height;
  } catch (e) {
    console.error(e);
  }
  // In the browser the viewport is the window.
  if (!rootWindowWidth || !rootWindowHeight) {
    rootWindowWidth = rootWindowWidth || window.innerWidth;
    rootWindowHeight = rootWindowHeight || window.innerHeight;
  }

  try {
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
      rootWindowHeight,
      rootWindowWidth,
      resizablePanelSizes,
    });
  } catch (e) {
    console.error(e);
    set({ rootWindowHeight, rootWindowWidth, resizablePanelSizes: {} });
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
