import { get, writable } from "svelte/store";
import { Events } from "@wailsio/runtime";
import * as events from "bindings/mqtt-viewer/events/models";
import {
  GetAppSettings,
  SetTopicPanelDock,
} from "bindings/mqtt-viewer/backend/app/app";

export type DockMode = "right" | "bottom" | "window";
export type DockSide = "right" | "bottom";

interface TopicPanelDockStore {
  mode: DockMode;
  lastDockedSide: DockSide;
}

const isDockMode = (value: string): value is DockMode =>
  value === "right" || value === "bottom" || value === "window";
const isDockSide = (value: string): value is DockSide =>
  value === "right" || value === "bottom";

const store = writable<TopicPanelDockStore>({
  mode: "right",
  lastDockedSide: "right",
});
const { subscribe, set } = store;

// Dock state lives in the AppSettings singleton (SQLite), not localStorage:
// localStorage is the weakest store across the three webviews, and the
// pop-out is a separate webview window, so a localStorage write here would
// never reach the main window. Every window (main and pop-outs) instead
// initialises from GetAppSettings and converges via TopicPanelDockChanged.
const init = async () => {
  try {
    const settings = await GetAppSettings();
    set({
      mode: isDockMode(settings.topicPanelDockMode)
        ? settings.topicPanelDockMode
        : "right",
      lastDockedSide: isDockSide(settings.topicPanelLastDockedSide)
        ? settings.topicPanelLastDockedSide
        : "right",
    });
  } catch (e) {
    console.error("error reading topic panel dock settings", e);
  }

  Events.On(events.GlobalEvent.TopicPanelDockChanged, (e) => {
    const data = e.data as { mode: string; lastDockedSide: string };
    if (!isDockMode(data.mode) || !isDockSide(data.lastDockedSide)) return;
    set({ mode: data.mode, lastDockedSide: data.lastDockedSide });
  });
};

// All dock changes, including re-dock from a pop-out's menu and
// revert-on-close, flow through this backend call and the resulting
// TopicPanelDockChanged event, never through window-local state alone.
const setMode = async (mode: DockMode) => {
  try {
    const lastDockedSide = mode === "window" ? get(store).lastDockedSide : mode;
    await SetTopicPanelDock(mode, lastDockedSide);
  } catch (e) {
    console.error("error setting topic panel dock", e);
  }
};

export default {
  subscribe,
  init,
  setMode,
};
