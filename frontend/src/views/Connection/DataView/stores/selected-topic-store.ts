import { get, writable } from "svelte/store";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import {
  GetMessageHistory,
  GetReceivedMessageWindow,
  GetReceivedMessageCount,
  GetAppSettings,
} from "bindings/mqtt-viewer/backend/app/app";
import { Events } from "@wailsio/runtime";
import type * as events from "bindings/mqtt-viewer/events/models";
import {
  base64ToUtf8,
  type SupportedCodeEditorCodec,
} from "@/components/CodeEditor/codec";
import type { SupportedCodeEditorFormat } from "@/components/CodeEditor/formatting";

export const HISTORY_WINDOW_SIZE = 5000;

export type MqttHistoryMessage = Omit<
  mqtt.MqttMessage,
  "payload" | "convertValues"
> & {
  payload: string;
  // The original base64 payload, kept alongside the utf8-decoded text so
  // binary payloads (e.g. images) can be rendered from their real bytes.
  payloadB64: string;
};

// When recording is on, history is paged from disk in windows; this tracks the
// current window so the user can move older/newer. In memory mode (recording
// off) the whole bounded RAM history is shown and window is null.
interface HistoryWindow {
  oldestId: number;
  newestId: number;
  // true when showing the most recent messages: live messages append here and
  // there is no newer window to load.
  isNewest: boolean;
}

interface SelectedTopicData {
  connectionId: number;
  connectionEventSet: events.ConnectionEventsSet;
  selectedTopic: string | null;
  history: MqttHistoryMessage[];
  historySource: "memory" | "disk";
  window: HistoryWindow | null;
  totalCount: number;
  options: {
    autoSelect: boolean;
    compare: boolean;
    decoding: SupportedCodeEditorCodec;
    format: SupportedCodeEditorFormat;
  };
  onNewMessages: null | ((messages: MqttHistoryMessage[]) => void);
}

export type SelectedTopicStore = ReturnType<typeof createSelectedTopicStore>;

const decode = (m: mqtt.MqttMessage): MqttHistoryMessage => ({
  ...m,
  payload: base64ToUtf8(m.payload as unknown as string),
  payloadB64: m.payload as unknown as string,
});

const numericId = (id: string): number => {
  const n = parseInt(id, 10);
  return Number.isNaN(n) ? 0 : n;
};

export const createSelectedTopicStore = (
  connectionId: number,
  connectionEventSet: events.ConnectionEventsSet
) => {
  const { subscribe, set, update } = writable<SelectedTopicData>(
    {
      connectionId,
      connectionEventSet,
      selectedTopic: null,
      history: [],
      historySource: "memory",
      window: null,
      totalCount: 0,
      onNewMessages: null,
      options: {
        autoSelect: true,
        compare: false,
        decoding: "none",
        format: "none",
      },
    },
    () => registerMessageListener()
  );

  // The live teardown for the Wails listeners while the store has
  // subscribers; destroy() lets a surface that owns the store outright (the
  // pop-out chart window) drop the listeners explicitly, same as the last
  // subscriber leaving.
  let activeTeardown: (() => void) | null = null;

  // Returns a teardown so the writable unsubscribes its Wails listeners when
  // the last store subscriber leaves (fixes the previous listener leak).
  const registerMessageListener = () => {
    const offMessages = Events.On(connectionEventSet.mqttMessages, (e: any) => {
      const messages: mqtt.MqttMessage[] = e.data;
      const store = get({ subscribe });
      if (store.selectedTopic === null) return;
      // Only the newest view receives live messages; older windows are frozen.
      if (store.historySource === "disk" && !store.window?.isNewest) return;

      const forTopic = messages.filter((m) => m.topic === store.selectedTopic);
      if (forTopic.length === 0) return;
      const decoded = forTopic.map(decode);
      if (store.onNewMessages !== null) store.onNewMessages(decoded);
      update((s) => {
        // Live messages carry their receive-time UUID, while disk rows carry
        // numeric ids. We only ever page the keyset by disk id, so a live
        // message's UUID resolves to 0 here and never moves the cursor — the
        // newestId stays the largest real disk id. Mixed ids in `history` are
        // fine for display/selection (all unique); never derive the cursor
        // from history[last].id, always from window.newestId.
        const window =
          s.window === null
            ? null
            : {
                ...s.window,
                newestId: Math.max(
                  s.window.newestId,
                  numericId(decoded[decoded.length - 1].id)
                ),
              };
        return {
          ...s,
          history: [...s.history, ...decoded],
          totalCount: s.totalCount + decoded.length,
          window,
        };
      });
    });
    const offClear = Events.On(connectionEventSet.mqttClearHistory, () => {
      update((s) => ({
        ...s,
        history: [],
        selectedTopic: null,
        window: null,
        totalCount: 0,
      }));
    });
    activeTeardown = () => {
      offMessages?.();
      offClear?.();
      activeTeardown = null;
    };
    return () => activeTeardown?.();
  };

  const destroy = () => activeTeardown?.();

  const isRecordingEnabled = async (): Promise<boolean> => {
    try {
      const settings = await GetAppSettings();
      return !!settings?.recordingEnabled;
    } catch {
      return false;
    }
  };

  const selectTopic = async (
    topic: string,
    onNewMessages?: (messages: MqttHistoryMessage[]) => void
  ) => {
    const { connectionId } = get({ subscribe });
    const recording = await isRecordingEnabled();

    if (recording) {
      const [count, windowMessages] = await Promise.all([
        GetReceivedMessageCount(connectionId, topic),
        GetReceivedMessageWindow(connectionId, topic, 0, 0, HISTORY_WINDOW_SIZE),
      ]);
      const decoded = windowMessages.map(decode);
      update((store) => ({
        ...store,
        selectedTopic: topic,
        history: decoded,
        historySource: "disk",
        window: windowFromMessages(decoded, true),
        totalCount: count,
        options: { ...store.options, autoSelect: true },
        onNewMessages: onNewMessages ?? null,
      }));
      return;
    }

    // Memory mode: the in-RAM history is already bounded by the memory budget.
    const history = await GetMessageHistory(connectionId, topic);
    const decoded = history.map(decode);
    update((store) => ({
      ...store,
      selectedTopic: topic,
      history: decoded,
      historySource: "memory",
      window: null,
      totalCount: decoded.length,
      options: { ...store.options, autoSelect: true },
      onNewMessages: onNewMessages ?? null,
    }));
  };

  const windowFromMessages = (
    messages: MqttHistoryMessage[],
    isNewest: boolean
  ): HistoryWindow | null => {
    if (messages.length === 0) return { oldestId: 0, newestId: 0, isNewest };
    return {
      oldestId: numericId(messages[0].id),
      newestId: numericId(messages[messages.length - 1].id),
      isNewest,
    };
  };

  // Loads the window immediately OLDER than the current one (moves left).
  const loadOlderWindow = async () => {
    const store = get({ subscribe });
    if (store.historySource !== "disk" || store.window === null) return;
    if (store.selectedTopic === null) return;
    const older = await GetReceivedMessageWindow(
      store.connectionId,
      store.selectedTopic,
      store.window.oldestId,
      0,
      HISTORY_WINDOW_SIZE
    );
    if (older.length === 0) return;
    const decoded = older.map(decode);
    update((s) => ({
      ...s,
      history: decoded,
      window: windowFromMessages(decoded, false),
    }));
  };

  // Loads the window immediately NEWER than the current one (moves right). If
  // it returns a partial window we've reached the latest, so live resumes.
  const loadNewerWindow = async () => {
    const store = get({ subscribe });
    if (store.historySource !== "disk" || store.window === null) return;
    if (store.selectedTopic === null) return;
    const newer = await GetReceivedMessageWindow(
      store.connectionId,
      store.selectedTopic,
      0,
      store.window.newestId,
      HISTORY_WINDOW_SIZE
    );
    if (newer.length === 0) {
      // Already at the latest — just mark the current window live.
      update((s) => ({
        ...s,
        window: s.window ? { ...s.window, isNewest: true } : null,
      }));
      return;
    }
    const decoded = newer.map(decode);
    const reachedLatest = newer.length < HISTORY_WINDOW_SIZE;
    update((s) => ({
      ...s,
      history: decoded,
      window: windowFromMessages(decoded, reachedLatest),
    }));
  };

  // Jumps back to the newest window and resumes live appends.
  const jumpToLatest = async () => {
    const store = get({ subscribe });
    if (store.historySource !== "disk" || store.selectedTopic === null) return;
    const windowMessages = await GetReceivedMessageWindow(
      store.connectionId,
      store.selectedTopic,
      0,
      0,
      HISTORY_WINDOW_SIZE
    );
    const decoded = windowMessages.map(decode);
    update((s) => ({
      ...s,
      history: decoded,
      window: windowFromMessages(decoded, true),
    }));
  };

  const deselectTopic = () => {
    update((store) => ({
      ...store,
      selectedTopic: null,
      history: [],
      window: null,
      totalCount: 0,
      onNewMessages: null,
    }));
  };

  const setOnNewMessages = (
    onNewMessages: null | ((messages: MqttHistoryMessage[]) => void)
  ) => {
    update((store) => ({ ...store, onNewMessages }));
  };

  const setComparing = (compare: boolean) => {
    update((store) => ({
      ...store,
      options: { ...store.options, compare },
    }));
  };

  const setAutoSelect = (autoSelect: boolean) => {
    update((store) => ({
      ...store,
      options: { ...store.options, autoSelect },
    }));
  };

  return {
    set,
    subscribe,
    selectTopic,
    deselectTopic,
    setOnNewMessages,
    setComparing,
    setAutoSelect,
    destroy,
    loadOlderWindow,
    loadNewerWindow,
    jumpToLatest,
  };
};
