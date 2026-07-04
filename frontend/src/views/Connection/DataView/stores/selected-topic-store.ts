import { get, writable } from "svelte/store";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import {
  GetMessageTimeline,
  GetMessageById,
  GetMessageHistory,
  GetReceivedTimelineWindow,
  GetReceivedMessageWindow,
  GetReceivedMessageById,
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

// Upper bound on how many disk-mode messages we keep loaded in memory at
// once. Once incremental loading (prepend/append) pushes past this, we evict
// from the end away from the change so the timeline never grows unbounded
// while the user pans through a busy topic's history.
export const MAX_LOADED_MESSAGES = 20000;

// Selecting a topic (and paging its window) only ever fetches lightweight
// stubs: id, arrival time, and small flags. Payloads are fetched individually
// on demand via ensurePayload, so a busy topic's 5,000-message window never
// serializes tens of MB of payload across the webview bridge in one go.
//
// payload/payloadB64 are null until fetched. payloadState tracks why:
//   - "unfetched": never requested (most history items, most of the time).
//   - "loading": a fetch is in flight (ensurePayload was called).
//   - "loaded": payload/payloadB64 are populated.
//   - "aged-out": the backend reported the message no longer exists (evicted
//     from the RAM budget, or pruned from disk); payload will never load.
export type PayloadState = "unfetched" | "loading" | "loaded" | "aged-out";

export type MqttHistoryMessage = Omit<
  mqtt.MqttMessage,
  "payload" | "convertValues"
> & {
  payload: string | null;
  // The original base64 payload, kept alongside the utf8-decoded text so
  // binary payloads (e.g. images) can be rendered from their real bytes.
  payloadB64: string | null;
  payloadState: PayloadState;
};

// A delta describing how `history` just changed, so consumers (the vis
// timeline) can apply the same change incrementally instead of rebuilding
// wholesale. Payload-only changes (ensurePayload landing) are NOT deltas: the
// timeline only cares about id/time/flags, all of which are already present
// on stub arrival.
export type HistoryDelta =
  | { kind: "append"; messages: MqttHistoryMessage[] } // live messages or loadNewer results
  | { kind: "prepend"; messages: MqttHistoryMessage[] } // loadOlder results
  | { kind: "trim"; ids: string[] }; // evicted messages (either end)

// When recording is on, history is paged from disk in windows; this tracks the
// current window so the user can move older/newer. In memory mode (recording
// off) the whole bounded RAM history is shown and window is null.
interface HistoryWindow {
  oldestId: number;
  newestId: number;
  // true when showing the most recent messages: live messages append here and
  // there is no newer window to load.
  isNewest: boolean;
  // true once we know there is nothing older on disk than history[0] (the
  // last older-fetch returned fewer than HISTORY_WINDOW_SIZE rows).
  atOldest: boolean;
}

interface SelectedTopicData {
  connectionId: number;
  connectionEventSet: events.ConnectionEventsSet;
  selectedTopic: string | null;
  history: MqttHistoryMessage[];
  historySource: "memory" | "disk";
  window: HistoryWindow | null;
  totalCount: number;
  // True while the initial history/window fetch for the current selection is
  // in flight. The panel shows a loading state in the timeline area while
  // this is true so opening a topic is instant even for a very busy topic.
  isLoadingHistory: boolean;
  // Bumped only on a wholesale replacement of `history` (selectTopic result
  // applied, jumpToLatest, clear-history, deselect). Incremental changes
  // (prepend/append/trim) do NOT bump this. The timeline component rebuilds
  // its dataset only when this changes, and otherwise applies deltas.
  historyRevision: number;
  // In-flight indicator for an incremental older/newer load; also doubles as
  // the single-flight guard for loadOlderWindow/loadNewerWindow.
  isLoadingWindow: "older" | "newer" | null;
  // Full-payload history for the Chart tab only. `history` itself never
  // carries every payload (that's the whole point of the stub windows), but
  // the chart draws a numeric series across the *entire* loaded window, which
  // genuinely needs every payload. Rather than fetch that on every topic
  // selection, it stays null until the user actually opens the Chart tab (or
  // already has fields picked), at which point ensureChartHistory fetches the
  // full window once via the pre-existing full-message binding. Bounded by
  // the same HISTORY_WINDOW_SIZE as everything else, so it is a bump in
  // bridge bytes only when the user opts into charting, never on selection.
  chartHistory: MqttHistoryMessage[] | null;
  isLoadingChartHistory: boolean;
  options: {
    autoSelect: boolean;
    compare: boolean;
    decoding: SupportedCodeEditorCodec;
    format: SupportedCodeEditorFormat;
  };
  onHistoryDelta: null | ((delta: HistoryDelta) => void);
}

export type SelectedTopicStore = ReturnType<typeof createSelectedTopicStore>;

// Builds a stub-shaped history entry (payload not yet fetched) from a
// MqttMessageStub returned by GetMessageTimeline/GetReceivedTimelineWindow.
const stubToHistoryMessage = (s: {
  id: string;
  timeMs: number;
  qos: number;
  retain: boolean;
}): MqttHistoryMessage =>
  ({
    id: s.id,
    topic: "",
    timeMs: s.timeMs,
    qos: s.qos,
    retain: s.retain,
    payload: null,
    payloadB64: null,
    payloadState: "unfetched",
  }) as MqttHistoryMessage;

// Decodes a full message (with payload) into the history shape, marking it
// loaded. Used for live appends and single-message fetches (ensurePayload),
// never for stub windows, which have no payload to decode.
const decode = (m: mqtt.MqttMessage): MqttHistoryMessage => ({
  ...m,
  payload: base64ToUtf8(m.payload as unknown as string),
  payloadB64: m.payload as unknown as string,
  payloadState: "loaded",
});

const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

// Decodes a large message batch without blocking the main thread: decoding
// (base64 -> utf8) is CPU-bound. Only ever used for live-append batches now
// (stub windows have nothing to decode), but kept chunked since a burst of
// live messages draining at once could still be sizeable.
const decodeChunked = async (
  messages: mqtt.MqttMessage[],
  chunk = 400
): Promise<MqttHistoryMessage[]> => {
  const result: MqttHistoryMessage[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i += chunk) {
    const end = Math.min(i + chunk, messages.length);
    for (let j = i; j < end; j++) {
      result[j] = decode(messages[j]);
    }
    if (end < messages.length) await yieldToEventLoop();
  }
  return result;
};

const numericId = (id: string): number => {
  const n = parseInt(id, 10);
  return Number.isNaN(n) ? 0 : n;
};

export const createSelectedTopicStore = (
  connectionId: number,
  connectionEventSet: events.ConnectionEventsSet
) => {
  // Monotonically increasing token identifying the "current" selection/fetch.
  // Every async load (selectTopic, loadOlderWindow, loadNewerWindow,
  // jumpToLatest, ensurePayload) captures the token at call time and, before
  // applying its result, checks it's still the current token and the
  // selected topic hasn't changed. This guards against a slow fetch for a
  // topic the user has since clicked away from (or a superseded window
  // navigation/payload fetch) landing late and clobbering newer state.
  let requestToken = 0;
  const isStale = (token: number, topic: string) => {
    const store = get({ subscribe });
    return token !== requestToken || store.selectedTopic !== topic;
  };

  const { subscribe, set, update } = writable<SelectedTopicData>(
    {
      connectionId,
      connectionEventSet,
      selectedTopic: null,
      history: [],
      historySource: "memory",
      window: null,
      totalCount: 0,
      isLoadingHistory: false,
      historyRevision: 0,
      isLoadingWindow: null,
      chartHistory: null,
      isLoadingChartHistory: false,
      onHistoryDelta: null,
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
      // While the initial history/window fetch is in flight, its result will
      // replace `history` wholesale once it lands. Rather than buffer and
      // reconcile live messages against it, we simply ignore live appends
      // during the load: the fetched window is the newest data on disk (or
      // the full bounded RAM history in memory mode) anyway, so nothing is
      // lost, and this keeps the loading path simple and race-free.
      if (store.isLoadingHistory) return;

      const forTopic = messages.filter((m) => m.topic === store.selectedTopic);
      if (forTopic.length === 0) return;
      const decoded = forTopic.map(decode);
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
          // Keep the chart's full-payload cache current if it's loaded, same
          // as the stub history above, so an open Chart tab keeps streaming
          // live points instead of needing a re-fetch.
          chartHistory:
            s.chartHistory === null ? null : [...s.chartHistory, ...decoded],
          totalCount: s.totalCount + decoded.length,
          window,
        };
      });
      if (store.onHistoryDelta !== null) {
        store.onHistoryDelta({ kind: "append", messages: decoded });
      }
      // The backend RAM budget bounds the backend's own history, but the
      // frontend's loaded `history` array still grows without bound for a
      // long-open panel on a busy topic in either mode, so enforce the cap
      // here for both. enforceCap already handles window === null (memory
      // mode) correctly.
      enforceCap("append");
    });
    const offClear = Events.On(connectionEventSet.mqttClearHistory, () => {
      requestToken++;
      update((s) => ({
        ...s,
        history: [],
        selectedTopic: null,
        window: null,
        totalCount: 0,
        isLoadingHistory: false,
        historyRevision: s.historyRevision + 1,
        isLoadingWindow: null,
        chartHistory: null,
        isLoadingChartHistory: false,
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

  // Enforces MAX_LOADED_MESSAGES by evicting from the end AWAY from the
  // change that just happened: a prepend grew the oldest end, so we evict
  // from the newest end (and vice versa for append/live append). Emits a
  // trim delta with the evicted ids after state has been updated.
  const enforceCap = (changeEnd: "prepend" | "append") => {
    const store = get({ subscribe });
    const excess = store.history.length - MAX_LOADED_MESSAGES;
    if (excess <= 0) return;

    let evicted: MqttHistoryMessage[];
    let kept: MqttHistoryMessage[];
    if (changeEnd === "prepend") {
      // Grew at the oldest end: evict the newest `excess` messages.
      kept = store.history.slice(0, store.history.length - excess);
      evicted = store.history.slice(store.history.length - excess);
    } else {
      // Grew at the newest end: evict the oldest `excess` messages.
      evicted = store.history.slice(0, excess);
      kept = store.history.slice(excess);
    }

    update((s) => {
      if (s.window === null) return { ...s, history: kept };
      let window = s.window;
      if (changeEnd === "prepend") {
        // Evicted from the newest end: no longer the newest window: recompute
        // newestId as the largest numeric id among kept messages, scanning
        // from the end and skipping non-numeric (UUID) ids.
        let newestId = window.newestId;
        for (let i = kept.length - 1; i >= 0; i--) {
          const n = numericId(kept[i].id);
          if (n !== 0) {
            newestId = n;
            break;
          }
        }
        window = { ...window, isNewest: false, newestId };
      } else {
        // Evicted from the oldest end: recompute oldestId as the first kept
        // message's numeric id, scanning forward past non-numeric ids.
        let oldestId = window.oldestId;
        for (let i = 0; i < kept.length; i++) {
          const n = numericId(kept[i].id);
          if (n !== 0) {
            oldestId = n;
            break;
          }
        }
        window = { ...window, atOldest: false, oldestId };
      }
      return { ...s, history: kept, window };
    });

    if (store.onHistoryDelta !== null) {
      store.onHistoryDelta({
        kind: "trim",
        ids: evicted.map((m) => m.id),
      });
    }
  };

  const selectTopic = async (
    topic: string,
    onHistoryDelta?: (delta: HistoryDelta) => void
  ) => {
    const { connectionId } = get({ subscribe });
    const token = ++requestToken;

    // Open the panel and show a loading state immediately, synchronously,
    // before any await below — the panel's visibility is driven by
    // `selectedTopic !== null`, so this is what makes selecting a topic feel
    // instant even when the fetch below takes a while.
    update((store) => ({
      ...store,
      selectedTopic: topic,
      history: [],
      window: null,
      totalCount: 0,
      isLoadingHistory: true,
      historyRevision: store.historyRevision + 1,
      isLoadingWindow: null,
      chartHistory: null,
      isLoadingChartHistory: false,
      options: { ...store.options, autoSelect: true },
      onHistoryDelta: onHistoryDelta ?? null,
    }));

    const recording = await isRecordingEnabled();
    if (isStale(token, topic)) return;

    if (recording) {
      const [count, stubs] = await Promise.all([
        GetReceivedMessageCount(connectionId, topic),
        GetReceivedTimelineWindow(connectionId, topic, 0, 0, HISTORY_WINDOW_SIZE),
      ]);
      if (isStale(token, topic)) return;
      const history = stubs.map((s) =>
        stubToHistoryMessageForTopic(s, topic)
      );
      update((store) => ({
        ...store,
        history,
        historySource: "disk",
        window: windowFromMessages(history, true),
        totalCount: count,
        isLoadingHistory: false,
        historyRevision: store.historyRevision + 1,
        isLoadingWindow: null,
      }));
      // Fetch exactly one payload (the newest stub) so the auto-selected
      // message renders immediately. Token-guarded inside ensurePayload.
      const newest = history[history.length - 1];
      if (newest) ensurePayload(newest.id);
      return;
    }

    // Memory mode: the in-RAM history is already bounded by the memory budget,
    // but we still cap what we pull across the bridge to HISTORY_WINDOW_SIZE
    // so a busy topic's full RAM history doesn't serialize as one unbounded
    // blob. Only stubs are fetched, no payloads, so even a 150k-message
    // topic's window is a few hundred KB, not tens of MB.
    const stubs = await GetMessageTimeline(
      connectionId,
      topic,
      HISTORY_WINDOW_SIZE
    );
    if (isStale(token, topic)) return;
    const history = stubs.map((s) => stubToHistoryMessageForTopic(s, topic));
    update((store) => ({
      ...store,
      history,
      historySource: "memory",
      window: null,
      totalCount: history.length,
      isLoadingHistory: false,
      historyRevision: store.historyRevision + 1,
      isLoadingWindow: null,
    }));
    const newest = history[history.length - 1];
    if (newest) ensurePayload(newest.id);
  };

  // stubToHistoryMessage doesn't know the topic (the backend stub type omits
  // it: every stub in a window is for the same topic by construction), but
  // MqttHistoryMessage's shape mirrors MqttMessage which does carry topic, so
  // fill it in here for consumers (compare mode, chart) that read it.
  const stubToHistoryMessageForTopic = (
    s: { id: string; timeMs: number; qos: number; retain: boolean },
    topic: string
  ): MqttHistoryMessage => ({ ...stubToHistoryMessage(s), topic });

  // Fetches and decodes a single message's payload by id, patching it into
  // `history` in place once it lands. No-ops (returns immediately) if the
  // stub isn't found, already loaded, or already loading. Does NOT fire a
  // history delta: the timeline only cares about id/time/flags, which don't
  // change here. Token-guarded so a stale fetch (user selected another topic
  // meanwhile) never clobbers newer state.
  const ensurePayload = async (id: string): Promise<void> => {
    const store = get({ subscribe });
    const topic = store.selectedTopic;
    if (topic === null) return;
    const index = store.history.findIndex((m) => m.id === id);
    if (index === -1) return;
    const target = store.history[index];
    if (target.payloadState === "loaded" || target.payloadState === "loading") {
      return;
    }

    const token = requestToken;
    update((s) => {
      const history = s.history.slice();
      const i = history.findIndex((m) => m.id === id);
      if (i === -1) return s;
      history[i] = { ...history[i], payloadState: "loading" };
      return { ...s, history };
    });

    try {
      let found: boolean;
      let full: mqtt.MqttMessage | null = null;
      if (store.historySource === "disk") {
        const numeric = numericId(id);
        const [msg, isFound] = await GetReceivedMessageById(
          store.connectionId,
          topic,
          numeric
        );
        found = isFound;
        full = msg;
      } else {
        const [msg, isFound] = await GetMessageById(
          store.connectionId,
          topic,
          id
        );
        found = isFound;
        full = msg;
      }
      if (isStale(token, topic)) return;

      update((s) => {
        const history = s.history.slice();
        const i = history.findIndex((m) => m.id === id);
        if (i === -1) return s;
        if (!found || full === null) {
          history[i] = { ...history[i], payloadState: "aged-out" };
        } else {
          history[i] = decode(full);
        }
        return { ...s, history };
      });
    } catch {
      if (isStale(token, topic)) return;
      update((s) => {
        const history = s.history.slice();
        const i = history.findIndex((m) => m.id === id);
        if (i === -1) return s;
        history[i] = { ...history[i], payloadState: "aged-out" };
        return { ...s, history };
      });
    }
  };

  const windowFromMessages = (
    messages: MqttHistoryMessage[],
    isNewest: boolean
  ): HistoryWindow | null => {
    if (messages.length === 0) {
      return { oldestId: 0, newestId: 0, isNewest, atOldest: true };
    }
    return {
      oldestId: numericId(messages[0].id),
      newestId: numericId(messages[messages.length - 1].id),
      isNewest,
      atOldest: messages.length < HISTORY_WINDOW_SIZE,
    };
  };

  // Loads the window immediately OLDER than the current one and prepends it
  // to the loaded history (moves left without discarding what's loaded).
  const loadOlderWindow = async () => {
    const store = get({ subscribe });
    if (store.historySource !== "disk" || store.window === null) return;
    if (store.selectedTopic === null) return;
    if (store.isLoadingWindow !== null) return;
    if (store.window.atOldest) return;
    const topic = store.selectedTopic;
    const token = requestToken;
    update((s) => ({ ...s, isLoadingWindow: "older" }));
    const olderStubs = await GetReceivedTimelineWindow(
      store.connectionId,
      topic,
      store.window.oldestId,
      0,
      HISTORY_WINDOW_SIZE
    );
    if (isStale(token, topic)) return;
    const older = olderStubs.map((s) => stubToHistoryMessageForTopic(s, topic));
    update((s) => {
      const history = [...older, ...s.history];
      const window =
        s.window === null
          ? null
          : {
              ...s.window,
              oldestId:
                older.length > 0 ? numericId(older[0].id) : s.window.oldestId,
              atOldest: older.length < HISTORY_WINDOW_SIZE,
            };
      // `history` grew with stub-only entries the chart cache doesn't have;
      // drop the cache so ensureChartHistory re-fetches fresh next render
      // rather than risk it silently diverging from `history`.
      return {
        ...s,
        history,
        window,
        isLoadingWindow: null,
        chartHistory: older.length > 0 ? null : s.chartHistory,
      };
    });
    // Re-read the callback: it may have been re-registered while the fetch
    // above was awaiting (e.g. the timeline rebuilt).
    const onHistoryDelta = get({ subscribe }).onHistoryDelta;
    if (onHistoryDelta !== null) {
      onHistoryDelta({ kind: "prepend", messages: older });
    }
    enforceCap("prepend");
  };

  // Loads the window immediately NEWER than the current one and appends it
  // to the loaded history (moves right without discarding what's loaded). If
  // it returns a partial window we've reached the latest, so live resumes.
  const loadNewerWindow = async () => {
    const store = get({ subscribe });
    if (store.historySource !== "disk" || store.window === null) return;
    if (store.selectedTopic === null) return;
    if (store.isLoadingWindow !== null) return;
    if (store.window.isNewest) return;
    const topic = store.selectedTopic;
    const token = requestToken;
    update((s) => ({ ...s, isLoadingWindow: "newer" }));
    const newerStubs = await GetReceivedTimelineWindow(
      store.connectionId,
      topic,
      0,
      store.window.newestId,
      HISTORY_WINDOW_SIZE
    );
    if (isStale(token, topic)) return;
    if (newerStubs.length === 0) {
      // Already at the latest, just mark the current window live.
      update((s) => ({
        ...s,
        window: s.window ? { ...s.window, isNewest: true } : null,
        isLoadingWindow: null,
      }));
      return;
    }
    const newer = newerStubs.map((s) => stubToHistoryMessageForTopic(s, topic));
    const reachedLatest = newer.length < HISTORY_WINDOW_SIZE;
    update((s) => {
      const history = [...s.history, ...newer];
      const window =
        s.window === null
          ? null
          : {
              ...s.window,
              newestId: numericId(newer[newer.length - 1].id),
              isNewest: reachedLatest,
            };
      // Same reasoning as loadOlderWindow: stub-only growth the chart cache
      // doesn't reflect, so drop it and let ensureChartHistory refetch.
      return { ...s, history, window, isLoadingWindow: null, chartHistory: null };
    });
    // Re-read the callback: it may have been re-registered while the fetch
    // above was awaiting (e.g. the timeline rebuilt).
    const onHistoryDelta = get({ subscribe }).onHistoryDelta;
    if (onHistoryDelta !== null) {
      onHistoryDelta({ kind: "append", messages: newer });
    }
    enforceCap("append");
  };

  // Jumps back to the newest window and resumes live appends.
  const jumpToLatest = async () => {
    const store = get({ subscribe });
    if (store.historySource !== "disk" || store.selectedTopic === null) return;
    const topic = store.selectedTopic;
    // A jump replaces the loaded history wholesale, so bump the token to
    // invalidate any in-flight older/newer load: with accumulation, a stale
    // prepend landing after the jump would corrupt the fresh window.
    const token = ++requestToken;
    const stubs = await GetReceivedTimelineWindow(
      store.connectionId,
      topic,
      0,
      0,
      HISTORY_WINDOW_SIZE
    );
    if (isStale(token, topic)) return;
    const history = stubs.map((s) => stubToHistoryMessageForTopic(s, topic));
    update((s) => ({
      ...s,
      history,
      window: windowFromMessages(history, true),
      historyRevision: s.historyRevision + 1,
      isLoadingWindow: null,
      // Wholesale replacement: the chart cache no longer matches `history`.
      chartHistory: null,
      isLoadingChartHistory: false,
    }));
    const newest = history[history.length - 1];
    if (newest) ensurePayload(newest.id);
  };

  const deselectTopic = () => {
    requestToken++;
    update((store) => ({
      ...store,
      selectedTopic: null,
      history: [],
      window: null,
      totalCount: 0,
      isLoadingHistory: false,
      historyRevision: store.historyRevision + 1,
      isLoadingWindow: null,
      chartHistory: null,
      isLoadingChartHistory: false,
      onHistoryDelta: null,
    }));
  };

  const setOnHistoryDelta = (
    onHistoryDelta: null | ((delta: HistoryDelta) => void)
  ) => {
    update((store) => ({ ...store, onHistoryDelta }));
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

  // Fetches the full-payload window for the CURRENT selection (via the
  // pre-existing full-message bindings) so the Chart tab can draw a numeric
  // series across the whole loaded window. This is the one place a busy
  // topic's payloads are fetched in bulk again, deliberately gated behind
  // the user opening the Chart tab (or already having chart fields picked),
  // never behind selecting a topic. No-ops if already loaded or loading, or
  // if nothing is selected. Token-guarded like every other async load here.
  const ensureChartHistory = async () => {
    const store = get({ subscribe });
    const topic = store.selectedTopic;
    if (topic === null) return;
    if (store.chartHistory !== null || store.isLoadingChartHistory) return;

    const token = requestToken;
    update((s) => ({ ...s, isLoadingChartHistory: true }));

    try {
      let decoded: MqttHistoryMessage[];
      if (store.historySource === "disk") {
        const full = await GetReceivedMessageWindow(
          store.connectionId,
          topic,
          0,
          0,
          HISTORY_WINDOW_SIZE
        );
        if (isStale(token, topic)) return;
        decoded = await decodeChunked(full);
      } else {
        const full = await GetMessageHistory(
          store.connectionId,
          topic,
          HISTORY_WINDOW_SIZE
        );
        if (isStale(token, topic)) return;
        decoded = await decodeChunked(full);
      }
      if (isStale(token, topic)) return;
      update((s) => ({ ...s, chartHistory: decoded, isLoadingChartHistory: false }));
    } catch {
      if (isStale(token, topic)) return;
      update((s) => ({ ...s, isLoadingChartHistory: false }));
    }
  };

  return {
    set,
    subscribe,
    selectTopic,
    deselectTopic,
    setOnHistoryDelta,
    setComparing,
    setAutoSelect,
    destroy,
    loadOlderWindow,
    loadNewerWindow,
    jumpToLatest,
    ensurePayload,
    ensureChartHistory,
  };
};
