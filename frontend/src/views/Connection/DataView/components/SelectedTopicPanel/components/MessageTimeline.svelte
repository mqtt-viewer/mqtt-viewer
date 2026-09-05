<script lang="ts" context="module">
  export type TimelineMessage = {
    id: string;
    arrivedAtMs: number;
    retained: boolean;
  };
</script>

<script lang="ts">
  import moment from "moment";
  import { onDestroy, onMount, tick } from "svelte";
  import "vis-timeline/styles/vis-timeline-graph2d.css";
  import {
    Timeline,
    type DataItemCollectionType,
    type TimelineOptions,
    type DataItem,
    type IdType,
  } from "vis-timeline/peer";
  import { DataSet } from "vis-data";
  import { untypedColors } from "@/util/resolvedTailwindConfig";
  import {
    MAX_LOADED_MESSAGES,
    type HistoryDelta,
    type MqttHistoryMessage,
    type SelectedTopicStore,
  } from "../../../stores/selected-topic-store";
  import Icon from "@/components/Icon/Icon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import {
    buildPayloadPreview,
    computePopoverPosition,
    type PayloadPreview,
  } from "./hover-preview";
  import { sampleEvenly } from "./timeline-sampling";
  import {
    computeInitialWindow,
    computeTimelineBounds,
    nextSelectionIndex,
  } from "./timeline-window";

  // Upper bound on how many items the vis-timeline DataSet holds at once.
  // The store's `history` array (and the payload/chart features that read
  // it) keeps up to MAX_LOADED_MESSAGES messages, but rendering that many
  // as vis-timeline DOM items is what saturates the main thread on a busy
  // topic; the visual timeline only ever needs to show a recent slice, so
  // it is bounded far tighter than the data itself. The initial rebuild on
  // topic select creates this many DOM items synchronously, so it directly
  // sets the select-time hitch: 1000 is visually indistinguishable from
  // 2000 in a 100px strip and halves that cost. Only the newest
  // TIMELINE_MAX_ITEMS are kept in timelineDataSet; older ones are trimmed
  // as appends arrive (see trimTimelineDataSetToMax below).
  //
  // Selection, keyboard navigation, hover and the pan bounds all work over
  // the DRAWN item set (the DataSet), not the full store history: the
  // timeline can only select, pan to or preview a dot that exists. Messages
  // trimmed or sampled out of the DataSet therefore aren't keyboard
  // reachable from here; they remain in the store's history for the payload
  // panel, the chart and the store's own navigation.
  const TIMELINE_MAX_ITEMS = 1000;

  // How much the DataSet may overshoot TIMELINE_MAX_ITEMS before
  // trimTimelineDataSetToMax actually trims: its get+sort over the whole
  // DataSet isn't free, so amortize it rather than pay it on every flush.
  const TIMELINE_TRIM_SLACK = 500;

  // Live append deltas arrive every ~300ms on a busy topic; adding to the
  // DataSet (and re-selecting the newest item) per drain is too much main
  // thread work, so appends are buffered and flushed at most this often.
  const APPEND_FLUSH_MS = 500;

  // Cap on how many DOM items a single append flush may create. At two
  // flushes per second this bounds item creation to ~300/s no matter how
  // fast the topic publishes; in a 100px strip more than about one dot
  // per two horizontal pixels is indistinguishable anyway, so the dropped
  // dots are invisible. Every message still lands in the store's history,
  // so the payload panel is unaffected; only the visual dot layer is
  // sampled.
  const FLUSH_MAX_ADDS = 150;

  // Cap on how many DOM items a single prepend (a loaded older window) may
  // create. A loaded older window spans a wide time range, so 500 evenly
  // sampled dots is already denser than the strip can show; matches the
  // rebuild's density philosophy instead of adding 5,000 items per window.
  const PREPEND_MAX_ADDS = 500;

  // Extra room left below the oldest drawn item while older disk rows are
  // still unloaded. The pan bounds otherwise stop just before the oldest
  // drawn dot, and the lazy older-window load (checkLazyLoad) needs the user
  // to be able to pan past that edge to trigger it. Tightened back to the
  // helper's own lead once the store reports it is at the oldest row.
  const LAZY_LOAD_LEAD_MS = 60 * 60 * 1000;

  // How long a programmatic pan animation runs, and so how long hover stays
  // suppressed after one starts (see suppressHover).
  const MOVE_ANIMATION_MS = 600;

  export let connectionId: number;
  export let selectedTopicStore: SelectedTopicStore;
  export let firstConnectedAtMs: number;
  export let onMessageSelect: (messageId: string | null) => void;
  export let isAutoSelectingMostRecent: boolean;

  let timelineIsFocused = true;
  let timelineDataSet: DataSet<DataItem, "id">;
  let timeline: Timeline;
  const initialWindow = computeInitialWindow(firstConnectedAtMs, Date.now());
  // The upper bound currently applied to the timeline; the intervals below
  // compare against it and refresh the bounds as time moves on.
  let currentMaxTime = initialWindow.end;
  let timelineEnsureNowVisibleInterval: NodeJS.Timeout;
  let timelineUpdateMaxInteral: NodeJS.Timeout;
  let defaultTimelineOptions: TimelineOptions = {
    min: initialWindow.start,
    max: initialWindow.end,
    stack: false,
    rollingMode: {
      follow: false,
    },
    showMajorLabels: true,
    itemsAlwaysDraggable: false,
    height: 100,
    template: (itemData, element, data) => {
      return `<div></div>`;
    },
  };
  let selectedMessageId: string | number | null = null;

  // The timeline's DOM host (the <section> below), bound by Svelte so
  // onMount, rebuilds and focus handling never have to look it up.
  let container: HTMLElement;

  // Live appends buffered between flushes (see APPEND_FLUSH_MS above) and
  // the pending flush timer. Cleared on destroy and on a wholesale rebuild.
  let pendingAppends: MqttHistoryMessage[] = [];
  let appendFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  // id -> message for every item currently in the DataSet, for the hover
  // popover: the vis DataSet doesn't carry qos/retain/payload and a linear
  // history scan per hover is wasteful. Kept in lockstep with the DataSet
  // (filled by getTimelineData on every add, pruned by forgetDrawn on every
  // removal, reset on rebuild) so it only ever describes what is drawn.
  let messageById = new Map<string, MqttHistoryMessage>();

  // The time span of the DRAWN items (the DataSet after sampling and
  // trimming), which is what the pan bounds describe: vis-timeline clamps
  // panning to [min, max], and there is nothing to pan to beyond the dots
  // that exist. Updated incrementally on add and rescanned on removal.
  let oldestMessageMs: number | null = null;
  let newestMessageMs: number | null = null;

  // Hover preview popover state.
  let hoveredMessage: MqttHistoryMessage | null = null;
  // Pending debounced hide; the 1s redraw fires a spurious itemout we ignore.
  let hideHoverTimeout: ReturnType<typeof setTimeout> | null = null;
  let popoverEl: HTMLDivElement | null = null;
  let popoverLeft = 0;
  let popoverTop = 0;
  // Kept invisible until measured and positioned to avoid a first-frame flash.
  let popoverPositioned = false;
  let hoverMouseX = 0;
  let hoverMouseY = 0;
  // Programmatic pans (click-to-select, keyboard nav, zoom, auto-select)
  // slide markers under a stationary cursor, making vis-timeline fire
  // itemover for a message the user never hovered. Hover is suppressed until
  // the move animation settles, unless the mouse has genuinely moved since
  // the pan started; re-fires for the already-shown message stay allowed.
  let lastMouseMoveAt = 0;
  let suppressStartedAt = 0;
  let suppressHoverUntil = 0;

  // What the popover body shows. History only carries stubs until a payload
  // is fetched, so hovering a stub shows a loading line while ensurePayload
  // (fired from showHover) lands, then the real preview.
  type HoverBody =
    | { kind: "loading" }
    | { kind: "aged-out" }
    | PayloadPreview;

  // The hovered message as the store currently holds it. `hoveredMessage` is
  // the snapshot taken when the dot was added to the DataSet, which predates
  // its payload landing; reading the live entry lets the preview update
  // reactively once ensurePayload patches the payload in. Same lookup the
  // panel does for the selected message.
  $: hoveredLiveMessage =
    hoveredMessage === null
      ? null
      : ($selectedTopicStore.history.find(
          (message) => message.id === hoveredMessage!.id
        ) ?? hoveredMessage);

  $: hoveredBody = buildHoverBody(hoveredLiveMessage);

  const buildHoverBody = (
    message: MqttHistoryMessage | null
  ): HoverBody | null => {
    if (message === null) return null;
    if (message.payloadState === "aged-out") return { kind: "aged-out" };
    if (message.payload === null || message.payloadB64 === null) {
      return { kind: "loading" };
    }
    return buildPayloadPreview(message.payload, message.payloadB64);
  };

  // Records a message as drawn: indexes it for hover and widens the drawn
  // span. Called for every item that goes into the DataSet.
  const noteDrawn = (message: MqttHistoryMessage) => {
    messageById.set(message.id, message);
    if (oldestMessageMs === null || message.timeMs < oldestMessageMs) {
      oldestMessageMs = message.timeMs;
    }
    if (newestMessageMs === null || message.timeMs > newestMessageMs) {
      newestMessageMs = message.timeMs;
    }
  };

  // Drops removed ids from the hover index and rescans the drawn span, since
  // a removal can shrink it from either end. O(DataSet size), which is
  // bounded by TIMELINE_MAX_ITEMS + TIMELINE_TRIM_SLACK, and removals are
  // rare (amortized trims and store evictions). Hides the popover if it was
  // showing a message that no longer exists in the DataSet.
  const forgetDrawn = (ids: IdType[]) => {
    for (const id of ids) {
      messageById.delete(id.toString());
    }
    oldestMessageMs = null;
    newestMessageMs = null;
    const remaining = timelineDataSet.get({ fields: ["start"] }) as {
      start: Date;
    }[];
    for (const item of remaining) {
      const timeMs = item.start.getTime();
      if (oldestMessageMs === null || timeMs < oldestMessageMs) {
        oldestMessageMs = timeMs;
      }
      if (newestMessageMs === null || timeMs > newestMessageMs) {
        newestMessageMs = timeMs;
      }
    }
    if (hoveredMessage !== null && !messageById.has(hoveredMessage.id)) {
      hideHover();
    }
  };

  // Empties the hover index and drawn span, for a wholesale DataSet reset.
  const resetDrawn = () => {
    messageById = new Map<string, MqttHistoryMessage>();
    oldestMessageMs = null;
    newestMessageMs = null;
  };

  const getTimelineData = (messages: MqttHistoryMessage[]) => {
    const timelineData: DataItemCollectionType = [];
    messages.forEach((message) => {
      noteDrawn(message);
      timelineData.push({
        id: message.id,
        content: `Message ${message.id}`,
        start: moment(message.timeMs).toDate(),
        className: message.retain ? "retained" : "not-retained",
      });
    });
    return timelineData;
  };

  // Builds the initial/rebuilt DataSet contents: at most
  // TIMELINE_MAX_ITEMS items sampled evenly across the whole loaded
  // history (already time-ordered oldest-first), so a 5,000+ item history
  // never creates that many vis-timeline DOM items in one go. Sampling
  // the whole loaded window rather than slicing the newest gives full-span
  // dot coverage when zoomed out, at the same bounded item count.
  const getBoundedTimelineData = (messages: MqttHistoryMessage[]) => {
    return getTimelineData(sampleEvenly(messages, TIMELINE_MAX_ITEMS));
  };

  // Enforces TIMELINE_MAX_ITEMS on the DataSet after new items are added,
  // evicting visual items from the requested end (NOT from the store's
  // `history`; only the vis-timeline DataSet is bounded). Cheap relative to
  // rendering: DataSet.remove on ids that are already off-screen doesn't
  // trigger the same per-item DOM work as the initial add. Amortized: only
  // trims once the DataSet overshoots by TIMELINE_TRIM_SLACK, then trims
  // back down to exactly TIMELINE_MAX_ITEMS.
  const trimTimelineDataSetToMax = (evictEnd: "oldest" | "newest" = "oldest") => {
    if (timelineDataSet.length <= TIMELINE_MAX_ITEMS + TIMELINE_TRIM_SLACK) {
      return;
    }
    const excess = timelineDataSet.length - TIMELINE_MAX_ITEMS;
    // DataSet iteration order isn't guaranteed to be insertion/time order,
    // so sort by start time to find the `excess` ids to evict from the
    // requested end.
    const items = timelineDataSet.get({ fields: ["id", "start"] }) as {
      id: IdType;
      start: Date;
    }[];
    items.sort((a, b) => a.start.getTime() - b.start.getTime());
    const toEvict =
      evictEnd === "oldest"
        ? items.slice(0, excess)
        : items.slice(items.length - excess);
    const evictedIds = toEvict.map((item) => item.id);
    timelineDataSet.remove(evictedIds);
    forgetDrawn(evictedIds);
  };

  // The drawn items sorted oldest-first, for keyboard navigation. DataSet
  // order isn't time order once prepends and sampled flushes are involved,
  // so sort explicitly; the DataSet is bounded, so this is cheap per
  // keypress.
  const getDrawnItemsInTimeOrder = () => {
    const items = timelineDataSet.get({ fields: ["id", "start"] }) as {
      id: IdType;
      start: Date;
    }[];
    items.sort((a, b) => a.start.getTime() - b.start.getTime());
    return items;
  };

  // vis-timeline hard-clamps panning to [min, max], so the bounds are
  // widened to cover the drawn span (recorded history and loaded older
  // windows both sit before this session's first connect) and extended past
  // the oldest drawn dot while older disk rows can still be lazily loaded.
  // The bounds are written back into defaultTimelineOptions so the periodic
  // setOptions calls below keep them, which means that object no longer
  // holds the pristine defaults once this has run.
  const computeCurrentBounds = () => {
    const window = $selectedTopicStore.window;
    const canLoadOlder =
      $selectedTopicStore.historySource === "disk" &&
      window !== null &&
      !window.atOldest;
    return computeTimelineBounds({
      firstConnectedAtMs,
      oldestMessageMs:
        oldestMessageMs !== null && canLoadOlder
          ? oldestMessageMs - LAZY_LOAD_LEAD_MS
          : oldestMessageMs,
      newestMessageMs,
      nowMs: Date.now(),
    });
  };

  // Single place all timeline.setOptions calls go through so nothing
  // accidentally resets the bounds back to the (stale) defaults. setOptions
  // re-renders every item, so this is only called when the bounds may have
  // moved: rebuild, prepend, and the periodic "keep now in range" checks.
  // Trims only ever tighten the span and are picked up on the next call.
  const applyTimelineBounds = () => {
    if (!timeline) return;
    const bounds = computeCurrentBounds();
    currentMaxTime = bounds.end;
    defaultTimelineOptions.min = bounds.start;
    defaultTimelineOptions.max = bounds.end;
    timeline.setOptions(defaultTimelineOptions);
  };

  const hideHover = () => {
    if (hideHoverTimeout) {
      clearTimeout(hideHoverTimeout);
      hideHoverTimeout = null;
    }
    hoveredMessage = null;
    popoverPositioned = false;
  };

  const suppressHover = () => {
    suppressStartedAt = Date.now();
    suppressHoverUntil = suppressStartedAt + MOVE_ANIMATION_MS;
  };

  // Renders the popover at body level so the timeline's overflow-hidden
  // wrapper can't clip it.
  const portalToBody = (node: HTMLElement) => {
    document.body.appendChild(node);
    return {
      destroy: () => {
        node.remove();
      },
    };
  };

  // Every programmatic pan goes through here so hover is suppressed while
  // markers slide under the cursor. Non-animated jumps still fire a spurious
  // itemover once, so they suppress too.
  const animatedMoveTo = (start: DataItem["start"], animate = true) => {
    suppressHover();
    timeline.moveTo(start, { animation: animate });
  };

  const positionPopover = () => {
    if (!popoverEl) return;
    const position = computePopoverPosition({
      mouseX: hoverMouseX,
      mouseY: hoverMouseY,
      popoverWidth: popoverEl.offsetWidth,
      popoverHeight: popoverEl.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    popoverLeft = position.left;
    popoverTop = position.top;
    popoverPositioned = true;
  };

  // The popover's height changes when a stub's payload lands after it was
  // first shown; re-measure once the new body has rendered so it stays
  // clear of the cursor.
  const repositionAfterRender = async () => {
    if (hoveredMessage === null) return;
    await tick();
    positionPopover();
  };
  $: hoveredBody, void repositionAfterRender();

  const showHover = async (messageId: string, event: MouseEvent) => {
    // During a programmatic pan, itemover fires for markers sliding under a
    // stationary cursor. Only honour it for the already-shown message (the
    // 1s redraw re-fires it) or when the mouse has actually moved since the
    // pan started, which makes it a real hover again.
    const isRefreshOfCurrent =
      hoveredMessage !== null && hoveredMessage.id === messageId;
    const mouseMovedSincePan = lastMouseMoveAt >= suppressStartedAt;
    if (
      Date.now() < suppressHoverUntil &&
      !isRefreshOfCurrent &&
      !mouseMovedSincePan
    ) {
      return;
    }
    // Cancel any debounced hide from a spurious itemout.
    if (hideHoverTimeout) {
      clearTimeout(hideHoverTimeout);
      hideHoverTimeout = null;
    }
    const message = messageById.get(messageId);
    // Guard against a hovered id that's no longer in the DataSet (eviction).
    if (!message) {
      hideHover();
      return;
    }
    hoverMouseX = event.clientX;
    hoverMouseY = event.clientY;
    // Re-firing on the already-shown message (eg. the 1s redraw) shouldn't blank
    // and re-measure the popover; just track the cursor and reposition.
    if (
      hoveredMessage &&
      hoveredMessage.id === message.id &&
      popoverPositioned
    ) {
      positionPopover();
      return;
    }
    hoveredMessage = message;
    popoverPositioned = false;
    // History only holds a stub until the payload is fetched; kick off the
    // fetch (a no-op if loaded or in flight) and let hoveredBody update
    // reactively when it lands. Live messages decode locally from their
    // retained bytes, so this is a bridge round-trip only for true stubs.
    selectedTopicStore.ensurePayload(message.id);
    // Wait for the popover to render before measuring it.
    await tick();
    positionPopover();
  };

  // Cancels the pending append flush and drops whatever it buffered. Used on
  // destroy and before a wholesale rebuild: the rebuild reads the full
  // current history, so flushing stale buffered appends afterwards would
  // double-add items.
  const cancelPendingAppends = () => {
    if (appendFlushTimer !== null) {
      clearTimeout(appendFlushTimer);
      appendFlushTimer = null;
    }
    pendingAppends = [];
  };

  // Applies the buffered live appends in one go, then (while auto-following)
  // moves the selection to the newest history message. Selection here reads
  // history[length - 1] directly: live appends always land at the end, so
  // there is no need for the findIndex over a 20k history the old
  // per-DataSet-add listener paid on every drain. sampleEvenly always keeps
  // the last element, so the newest history message is always drawn.
  //
  // Items go in via DataSet.update (an upsert) rather than add: add throws
  // on an id the DataSet already holds, and a throw here used to leave the
  // buffer intact so every later flush threw too and the timeline froze.
  // The buffer is also taken before the DataSet is touched, so even an
  // unexpected exception can never wedge later flushes.
  const flushAppends = () => {
    appendFlushTimer = null;
    if (destroyed || pendingAppends.length === 0) return;
    const batch = pendingAppends;
    pendingAppends = [];
    if (batch.length >= TIMELINE_MAX_ITEMS) {
      // The buffer alone fills the visual cap: cheaper to rebuild the
      // DataSet than to add everything and immediately trim most of it out.
      // Sample across the whole buffer rather than slicing the newest so
      // the dots cover the full flushed span evenly.
      timelineDataSet.clear();
      resetDrawn();
      hideHover();
      timelineDataSet.update(
        getTimelineData(sampleEvenly(batch, TIMELINE_MAX_ITEMS))
      );
    } else {
      timelineDataSet.update(
        getTimelineData(sampleEvenly(batch, FLUSH_MAX_ADDS))
      );
      trimTimelineDataSetToMax();
    }

    if (!isAutoSelectingMostRecent) return;
    const history = $selectedTopicStore.history;
    if (history.length === 0) return;
    const last = history[history.length - 1];
    selectedMessageId = last.id;
    timeline.setSelection([last.id]);
    onMessageSelect(last.id.toString());
    const item = timelineDataSet.get(last.id);
    // Skip the viewport move when the new item is already visible, and never
    // animate: an animated moveTo per flush compounds into a continuously
    // tweening viewport the timeline can't keep up with.
    if (item && !isWithinVisibleWindow(item.start as Date)) {
      animatedMoveTo(item.start, false);
    }
  };

  // Checks whether the current visible range is close enough to the edge of
  // what's loaded that we should kick off loading the next window. Only
  // applies in disk mode with a window; a no-op otherwise (the store's
  // single-flight guard also makes repeat calls harmless).
  const checkLazyLoad = (startMs: number, endMs: number) => {
    const window = $selectedTopicStore.window;
    if ($selectedTopicStore.historySource !== "disk" || window === null) {
      return;
    }
    const history = $selectedTopicStore.history;
    if (history.length === 0) return;
    const margin = 0.25 * (endMs - startMs);
    const oldestLoadedMs = history[0].timeMs;
    const newestLoadedMs = history[history.length - 1].timeMs;
    if (!window.atOldest && startMs < oldestLoadedMs + margin) {
      selectedTopicStore.loadOlderWindow();
    }
    if (!window.isNewest && endMs > newestLoadedMs - margin) {
      selectedTopicStore.loadNewerWindow();
    }
  };

  const handleHistoryDelta = (delta: HistoryDelta) => {
    if (delta.kind === "append") {
      // Buffer rather than apply: see APPEND_FLUSH_MS. Appending to the
      // buffer is O(batch); all the DataSet/DOM/selection cost is deferred
      // to the throttled flush.
      pendingAppends.push(...delta.messages);
      if (appendFlushTimer === null) {
        appendFlushTimer = setTimeout(flushAppends, APPEND_FLUSH_MS);
      }
      return;
    }
    if (delta.kind === "prepend") {
      // update, not add: same duplicate-id safety as flushAppends.
      timelineDataSet.update(
        getTimelineData(sampleEvenly(delta.messages, PREPEND_MAX_ADDS))
      );
      // The user is panning into the past: evict from the newest end, the
      // direction they are moving away from.
      trimTimelineDataSetToMax("newest");
      // The new window reaches further back than the old bounds allowed, so
      // widen them or panning into it stays clamped.
      applyTimelineBounds();
      // The view may still extend past the new oldest point (or new/newer
      // point), so re-check whether another load should kick off. Cap the
      // cascade so a zoomed-out view can't loop through the whole table.
      if ($selectedTopicStore.history.length < MAX_LOADED_MESSAGES) {
        const range = timeline.getWindow();
        checkLazyLoad(range.start.getTime(), range.end.getTime());
      }
      return;
    }
    // trim
    timelineDataSet.remove(delta.ids);
    forgetDrawn(delta.ids);
    // Buffered appends may include ids the store just evicted; drop them so
    // the next flush can't add items the store no longer holds. Trims are
    // rare (amortized in the store) so the filter cost is negligible.
    if (pendingAppends.length > 0) {
      const trimmedIds = new Set(delta.ids);
      pendingAppends = pendingAppends.filter((m) => !trimmedIds.has(m.id));
    }
    if (selectedMessageId !== null && delta.ids.includes(selectedMessageId.toString())) {
      selectedMessageId = null;
      onMessageSelect(null);
    }
  };

  // Selects the last message in the store's (time-ordered) history, which
  // is always drawn (see flushAppends), rather than reading
  // timelineDataSet.get() insertion order, which breaks once prepends are
  // involved.
  const selectLastHistoryMessage = (animate = true) => {
    const history = $selectedTopicStore.history;
    if (history.length === 0) return;
    const lastMessage = history[history.length - 1];
    selectedMessageId = lastMessage.id;
    timeline.setSelection([lastMessage.id]);
    onMessageSelect(lastMessage.id.toString());
    const item = timelineDataSet.get(lastMessage.id);
    if (item) {
      animatedMoveTo(item.start, animate);
    }
  };

  onMount(() => {
    timelineDataSet = new DataSet<DataItem, "id">();
    const timelineData = getBoundedTimelineData($selectedTopicStore.history);
    timelineDataSet.update(timelineData);
    selectedTopicStore.setOnHistoryDelta(handleHistoryDelta);
    // The dataset is built first so the bounds already take in the drawn
    // history when the timeline is constructed.
    const initialBounds = computeCurrentBounds();
    currentMaxTime = initialBounds.end;
    defaultTimelineOptions.min = initialBounds.start;
    defaultTimelineOptions.max = initialBounds.end;
    timeline = new Timeline(container, timelineDataSet, defaultTimelineOptions);
    if (timelineDataSet.length > 0) {
      selectLastHistoryMessage(false);
    }

    // The bounds may now stretch well before the first connect, but the
    // timeline still opens on this session's span.
    const openingWindow = computeInitialWindow(firstConnectedAtMs, Date.now());
    timeline.setWindow(openingWindow.start, openingWindow.end, {
      animation: false,
    });

    // Hover is a pure preview: show the message on itemover, hide on
    // itemout. It never touches selection.
    timeline.on(
      "itemover",
      (properties: { item: IdType; event: MouseEvent }) => {
        showHover(properties.item.toString(), properties.event);
      }
    );
    timeline.on("itemout", () => {
      // Debounce the hide: the 1s setOptions redraw fires a spurious
      // itemout/itemover pair that would otherwise flicker the popover.
      hideHoverTimeout = setTimeout(hideHover, 60);
    });

    timeline.on("select", (properties: { items: IdType[] }) => {
      hideHover();
      if (properties.items.length === 0) {
        onMessageSelect(null);
        isAutoSelectingMostRecent = false;
        return;
      }
      const selectedId = properties.items[0];
      const selectedMessage = timelineDataSet.get(selectedId);
      const history = $selectedTopicStore.history;
      const lastHistoryMessage = history[history.length - 1];
      if (!selectedId || !lastHistoryMessage || selectedId !== lastHistoryMessage.id) {
        isAutoSelectingMostRecent = false;
      }
      selectedMessageId = selectedId;
      onMessageSelect(selectedId.toString());
      if (selectedMessage) {
        animatedMoveTo(selectedMessage.start);
      }
    });

    timeline.on(
      "rangechanged",
      (properties: { start: Date; end: Date; byUser: boolean }) => {
        if (!properties.byUser) return;
        const startMs = properties.start.getTime();
        const endMs = properties.end.getTime();
        const history = $selectedTopicStore.history;
        const newestLoadedMs =
          history.length > 0 ? history[history.length - 1].timeMs : null;
        if (newestLoadedMs !== null && endMs < newestLoadedMs) {
          isAutoSelectingMostRecent = false;
        }
        checkLazyLoad(startMs, endMs);
      }
    );

    timelineUpdateMaxInteral = setInterval(
      () => {
        applyTimelineBounds();
      },
      9 * 60 * 1000
    );
    // If eg. a laptop is closed, we don't want the timeline to not show the current time
    // once the app resumes. Only extend (and only then call setOptions, which
    // fully re-renders every item) once "now" gets within a minute of the
    // current max. Compares .getTime() (ms since epoch), not
    // .getMilliseconds() (0-999 sub-second component), which previously made
    // this condition true unconditionally and re-rendered the whole timeline
    // every second regardless of busyness.
    timelineEnsureNowVisibleInterval = setInterval(() => {
      const nowMs = new Date().getTime();
      if (nowMs > currentMaxTime.getTime() - 60 * 1000) {
        applyTimelineBounds();
      }
    }, 1000);
  });

  onDestroy(() => {
    destroyed = true;
    cancelPendingAppends();
    hideHover();
    resetDrawn();
    if (!!timeline) {
      timeline.destroy();
      timelineDataSet.clear();
    }
    if (!!timelineUpdateMaxInteral) {
      clearInterval(timelineUpdateMaxInteral);
    }
    if (!!timelineEnsureNowVisibleInterval) {
      clearInterval(timelineEnsureNowVisibleInterval);
    }
    selectedTopicStore.setOnHistoryDelta(null);
  });

  // True when `time` already falls inside the timeline's current visible
  // window, so a moveTo would be a no-op pan anyway.
  const isWithinVisibleWindow = (time: Date) => {
    const range = timeline.getWindow();
    return time >= range.start && time <= range.end;
  };

  // When following turns on, snap to the newest message once for immediate
  // feedback; from then on each append flush keeps the selection following
  // (see flushAppends), so no per-DataSet-add listener is needed.
  $: isAutoSelectingMostRecent,
    (() => {
      if (!timeline || !timelineDataSet) return;
      if (isAutoSelectingMostRecent) {
        selectLastHistoryMessage();
      }
    })();

  let innerSelectedTopic = $selectedTopicStore.selectedTopic;
  // Tracks historyRevision so a wholesale replacement (new topic, jump to
  // latest, clear-history) rebuilds the dataset. Incremental changes
  // (prepend/append/trim) do NOT bump historyRevision and are instead
  // applied via handleHistoryDelta, so they don't trigger a rebuild here.
  let innerHistoryRevision = $selectedTopicStore.historyRevision;

  const rebuildTimelineFromHistory = () => {
    // A rebuild replaces the dataset wholesale from the full current
    // history; stale buffered appends would double-add items on flush.
    cancelPendingAppends();
    hideHover();
    resetDrawn();
    timelineDataSet = new DataSet<DataItem, "id">();
    // update, not add: same duplicate-id safety as flushAppends.
    timelineDataSet.update(getBoundedTimelineData($selectedTopicStore.history));
    selectedTopicStore.setOnHistoryDelta(handleHistoryDelta);
    timeline.setItems(timelineDataSet);
    // The new window can reach further back than the old bounds allowed, so
    // widen them before panning or the move is clamped.
    applyTimelineBounds();
    // Select the most recent message in the (re)loaded window by default.
    if (timelineDataSet.length > 0) {
      selectLastHistoryMessage(false);
    } else {
      // A topic with no history clears the selection outright rather than
      // leaving the panel holding the previous topic's message id.
      selectedMessageId = null;
      timeline.setSelection([]);
      onMessageSelect(null);
    }
    timelineIsFocused = true;
    container?.focus();
  };

  $: {
    const topic = $selectedTopicStore.selectedTopic;
    const historyRevision = $selectedTopicStore.historyRevision;
    if (timeline && topic !== "" && topic !== null) {
      if (
        innerSelectedTopic !== topic ||
        innerHistoryRevision !== historyRevision
      ) {
        innerSelectedTopic = topic;
        innerHistoryRevision = historyRevision;
        rebuildTimelineFromHistory();
      }
    }
  }

  // Keyboard next/previous walks the DRAWN items in time order so the
  // selection always lands on a dot the timeline can pan to. Items sampled
  // or trimmed out of the DataSet are skipped over (they are not keyboard
  // reachable from here). The index is derived from the selected id rather
  // than stored: adds and trims reshuffle the drawn set, and a selection
  // that was trimmed away recovers to the newest dot via nextSelectionIndex.
  $: selectNextOrPreviousMessage = (action: "next" | "previous") => {
    if (!timeline || !timelineDataSet) return;
    const items = getDrawnItemsInTimeOrder();
    if (items.length === 0) return;
    const currentIndex =
      selectedMessageId === null
        ? -1
        : items.findIndex((item) => item.id === selectedMessageId);
    if (action === "previous" && currentIndex === 0) {
      const window = $selectedTopicStore.window;
      if (
        $selectedTopicStore.historySource === "disk" &&
        window !== null &&
        !window.atOldest
      ) {
        // Older messages exist on disk but aren't loaded yet: kick off the
        // load and leave the selection where it is; the user can step
        // previous again once the older window arrives.
        selectedTopicStore.loadOlderWindow();
        return;
      }
    }
    const nextMessageIndex = nextSelectionIndex(
      currentIndex === -1 ? null : currentIndex,
      items.length,
      action
    );
    if (nextMessageIndex === null) return;
    const nextMessage = items[nextMessageIndex];
    if (!nextMessage) return;
    selectedMessageId = nextMessage.id;
    timeline.setSelection([nextMessage.id]);
    onMessageSelect(nextMessage.id.toString());
    hideHover();
    animatedMoveTo(nextMessage.start);
  };

  $: zoomIn = () => {
    hideHover();
    suppressHover();
    timeline.zoomIn(1);
  };

  $: zoomOut = () => {
    hideHover();
    suppressHover();
    timeline.zoomOut(1);
  };

  $: onKeydown = (
    event: KeyboardEvent & {
      currentTarget: EventTarget;
    }
  ) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    switch (event.code) {
      case "KeyD":
      case "ArrowRight":
        selectNextOrPreviousMessage("next");
        isAutoSelectingMostRecent = false;
        break;
      case "KeyA":
      case "ArrowLeft":
        selectNextOrPreviousMessage("previous");
        isAutoSelectingMostRecent = false;
        break;
      case "KeyW":
      case "ArrowUp":
        zoomIn();
        break;
      case "KeyS":
      case "ArrowDown":
        zoomOut();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  $: loadingWindowLabel =
    $selectedTopicStore.isLoadingWindow === "older"
      ? "Loading older messages..."
      : $selectedTopicStore.isLoadingWindow === "newer"
        ? "Loading newer messages..."
        : null;
</script>

<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<section
  bind:this={container}
  autofocus
  tabindex="0"
  on:click={(event) => {
    event.currentTarget.focus();
  }}
  on:focus={() => {
    timelineIsFocused = true;
  }}
  on:blur={() => {
    timelineIsFocused = false;
  }}
  on:keydown={onKeydown}
  on:mousemove|capture={() => {
    lastMouseMoveAt = Date.now();
  }}
  on:mouseleave={hideHover}
  id="timeline"
  class={`
    py-[1px]
    timeline timeline-${connectionId} rounded-sm relative
    ${timelineIsFocused ? "border-[1px] border-primary-light/40" : "border-[1px] border-outline"}
  `}
  style:--primary={untypedColors["primary"]["DEFAULT"]}
  style:--primary-light={untypedColors["primary"]["light"]}
  style:--secondary={untypedColors["secondary"]["DEFAULT"]}
>
  {#if loadingWindowLabel !== null}
    <div
      class="absolute z-10 top-[2px] left-[4px] text-secondary-text text-xs bg-elevation-1/80 rounded px-1 pointer-events-none"
    >
      {loadingWindowLabel}
    </div>
  {/if}
  <div
    class="absolute z-10 size-[10px] bottom-[9px] right-[9px] text-secondary-text cursor-pointer"
  >
    <Tooltip
      closeOnPointerDown={false}
      text="Use W-A-S-D or arrow keys to select messages and zoom"
    >
      <Icon type="info" />
    </Tooltip>
  </div>

  {#if hoveredMessage && hoveredBody}
    <div
      bind:this={popoverEl}
      use:portalToBody
      class={`
        pointer-events-none fixed z-[10003] max-w-[320px]
        rounded bg-elevation-2 shadow border-[1px] border-outline
        px-2 py-1.5 text-xs text-emphasis
        ${popoverPositioned ? "" : "invisible"}
      `}
      style:left={`${popoverLeft}px`}
      style:top={`${popoverTop}px`}
    >
      <div class="flex items-center gap-2 text-secondary-text">
        <span>{moment(hoveredMessage.timeMs).format("H:mm:ss.SS")}</span>
        <span>QoS {hoveredMessage.qos}</span>
        {#if hoveredMessage.retain}
          <span class="text-secondary">Retained</span>
        {/if}
      </div>
      {#if hoveredBody.kind === "loading"}
        <div class="mt-1 text-secondary-text">Loading payload...</div>
      {:else if hoveredBody.kind === "aged-out"}
        <div class="mt-1 text-secondary-text">Payload no longer available</div>
      {:else if hoveredBody.kind === "binary"}
        <div class="mt-1 text-secondary-text">{hoveredBody.summary}</div>
      {:else}
        <div
          class="mt-1 font-mono whitespace-pre-wrap break-all
            max-h-[140px] overflow-hidden line-clamp-[8]"
        >
          {hoveredBody.text}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style global>
  #timeline {
    width: 100%;
    height: 100px;
  }

  .vis-timeline {
    border: 0px;
  }

  .vis-content {
    height: 70px;
  }

  /* vis-timeline's default pale-blue item fill is invisible on the light
     theme, so unselected markers take the primary colour at reduced
     opacity; selection and retained rules below override it. */
  .vis-item.vis-box {
    background-color: var(--color-primary);
    opacity: 0.55;
  }

  .vis-item.vis-box.vis-selected,
  .vis-item.vis-box.retained {
    opacity: 1;
  }

  .vis-item.vis-box.retained {
    background-color: var(--color-secondary);
  }

  .vis-item.vis-box.vis-selected {
    background-color: var(--primary-light);
    --tw-ring-color: var(--color-primary);
    --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0
      var(--tw-ring-offset-width) var(--tw-ring-offset-color);
    --tw-ring-shadow: var(--tw-ring-inset) 0 0 0
      calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color);
    box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow),
      var(--tw-shadow, 0 0 #0000);
  }

  .vis-item-content {
    height: 60px;
    width: 6px;
  }

  .vis-item {
    border-width: 0px;
    border-color: var(--color-timeline-border);
  }

  .vis-item.vis-dot {
    border-width: 0px;
  }

  .vis-item .vis-item-content {
    padding: 0px;
    height: 35px;
  }

  .vis-content {
    height: 50px !important;
    overflow: hidden;
  }

  .vis-itemset {
    height: 50px !important;
    overflow: hidden;
  }

  .vis-time-axis .vis-text {
    color: var(--color-secondary-text);
  }

  .vis-time-axis .vis-grid.vis-minor {
    border-width: 0.5px;
    border-color: var(--color-timeline-border);
  }

  .vis-panel.vis-center {
    border-width: 0.5px;
    border-color: var(--color-timeline-border);
  }

  .vis-panel.vis-bottom {
    border-width: 0.5px;
    border-color: var(--color-timeline-border);
  }
</style>
