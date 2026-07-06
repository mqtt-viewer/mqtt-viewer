<script lang="ts" context="module">
  export type TimelineMessage = {
    id: string;
    arrivedAtMs: number;
    retained: boolean;
  };
</script>

<script lang="ts">
  import moment from "moment";
  import { onDestroy, onMount } from "svelte";
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
  import { sampleEvenly } from "./timeline-sampling";

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
  // as appends arrive (see trimTimelineDataSetToMax below). Keyboard
  // next/previous and selection still derive from the full store history,
  // so navigating past the trimmed edge still works — it just can't
  // visually pan the timeline to an item that isn't loaded into it.
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
  // so selection and keyboard navigation are unaffected — only the visual
  // dot layer is sampled.
  const FLUSH_MAX_ADDS = 150;

  // Cap on how many DOM items a single prepend (a loaded older window) may
  // create. A loaded older window spans a wide time range, so 500 evenly
  // sampled dots is already denser than the strip can show; matches the
  // rebuild's density philosophy instead of adding 5,000 items per window.
  const PREPEND_MAX_ADDS = 500;

  export let connectionId: number;
  export let selectedTopicStore: SelectedTopicStore;
  export let firstConnectedAtMs: number;
  export let onMessageSelect: (messageId: string | null) => void;
  export let isAutoSelectingMostRecent: boolean;

  let timelineIsFocused = true;
  let timelineDataSet: DataSet<DataItem, "id">;
  let timeline: Timeline;
  let minTimelineTime = moment(firstConnectedAtMs).add(-1, "minutes").toDate();
  let maxTimelineTime = moment().add(10, "minutes").toDate();
  // The lower bound applied to the timeline. Normally pinned to session
  // start, but widened to allow panning back into disk history recorded
  // before this app session — see recomputeMin().
  let currentMin = minTimelineTime;
  let timelineEnsureNowVisibleInterval: NodeJS.Timeout;
  let timelineUpdateMaxInteral: NodeJS.Timeout;
  let defaultTimelineOptions: TimelineOptions = {
    min: minTimelineTime,
    max: maxTimelineTime,
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
  let selectedMessageIndex: number | null = null;

  // Live appends buffered between flushes (see APPEND_FLUSH_MS above) and
  // the pending flush timer. Cleared on destroy and on a wholesale rebuild.
  let pendingAppends: MqttHistoryMessage[] = [];
  let appendFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const getTimelineData = (messages: MqttHistoryMessage[]) => {
    const timelineData: DataItemCollectionType = [];
    messages.forEach((message) => {
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
  // `history` — only the vis-timeline DataSet is bounded). Cheap relative to
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
    timelineDataSet.remove(toEvict.map((item) => item.id));
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
  // history[length - 1] directly — live appends always land at the end, so
  // there is no need for the findIndex over a 20k history the old
  // per-DataSet-add listener paid on every drain.
  const flushAppends = () => {
    appendFlushTimer = null;
    if (destroyed || pendingAppends.length === 0) return;
    if (pendingAppends.length >= TIMELINE_MAX_ITEMS) {
      // The buffer alone fills the visual cap: cheaper to rebuild the
      // DataSet than to add everything and immediately trim most of it out.
      // Sample across the whole buffer rather than slicing the newest so
      // the dots cover the full flushed span evenly.
      timelineDataSet.clear();
      timelineDataSet.add(
        getTimelineData(sampleEvenly(pendingAppends, TIMELINE_MAX_ITEMS))
      );
    } else {
      timelineDataSet.add(
        getTimelineData(sampleEvenly(pendingAppends, FLUSH_MAX_ADDS))
      );
      trimTimelineDataSetToMax();
    }
    pendingAppends = [];

    if (!isAutoSelectingMostRecent) return;
    const history = $selectedTopicStore.history;
    if (history.length === 0) return;
    const last = history[history.length - 1];
    selectedMessageId = last.id;
    selectedMessageIndex = history.length - 1;
    timeline.setSelection([last.id]);
    onMessageSelect(last.id.toString());
    const item = timelineDataSet.get(last.id);
    // Skip the viewport move when the new item is already visible, and never
    // animate: an animated moveTo per flush compounds into a continuously
    // tweening viewport the timeline can't keep up with.
    if (item && !isWithinVisibleWindow(item.start as Date)) {
      timeline.moveTo(item.start, { animation: false });
    }
  };

  // Recomputes currentMin: normally session start minus a minute, but when
  // disk history is loaded and there may be more to load older than what's
  // currently in view, extend further back to leave room to pan/trigger a
  // lazy load. Once we know we're at the oldest disk row, tighten back up.
  const recomputeMin = () => {
    const window = $selectedTopicStore.window;
    const history = $selectedTopicStore.history;
    const sessionMin = moment(firstConnectedAtMs).add(-1, "minutes").toDate();
    if (window === null || history.length === 0) {
      currentMin = sessionMin;
      return;
    }
    const oldestLoadedTime = history[0].timeMs;
    const slackMs = window.atOldest ? 60 * 1000 : 60 * 60 * 1000;
    const extendedMin = moment(oldestLoadedTime).add(-slackMs, "ms").toDate();
    currentMin = extendedMin < sessionMin ? extendedMin : sessionMin;
  };

  // Single place all timeline.setOptions calls go through so nothing
  // accidentally resets `min` back to the (stale) default.
  const applyTimelineOptions = () => {
    if (!timeline) return;
    timeline.setOptions({
      ...defaultTimelineOptions,
      min: currentMin,
      max: maxTimelineTime,
    });
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
      timelineDataSet.add(
        getTimelineData(sampleEvenly(delta.messages, PREPEND_MAX_ADDS))
      );
      // The user is panning into the past: evict from the newest end, the
      // direction they are moving away from.
      trimTimelineDataSetToMax("newest");
      recomputeMin();
      applyTimelineOptions();
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
    // Buffered appends may include ids the store just evicted; drop them so
    // the next flush can't add items the store no longer holds. Trims are
    // rare (amortized in the store) so the filter cost is negligible.
    if (pendingAppends.length > 0) {
      const trimmedIds = new Set(delta.ids);
      pendingAppends = pendingAppends.filter((m) => !trimmedIds.has(m.id));
    }
    if (selectedMessageId !== null && delta.ids.includes(selectedMessageId.toString())) {
      selectedMessageId = null;
      selectedMessageIndex = null;
      onMessageSelect(null);
    }
  };

  // Selects the last message in the store's (time-ordered) history — used
  // instead of reading timelineDataSet.get() insertion order, which breaks
  // once prepends are involved.
  const selectLastHistoryMessage = (animate = true) => {
    const history = $selectedTopicStore.history;
    if (history.length === 0) return;
    const lastMessage = history[history.length - 1];
    selectedMessageId = lastMessage.id;
    selectedMessageIndex = history.length - 1;
    timeline.setSelection([lastMessage.id]);
    onMessageSelect(lastMessage.id.toString());
    const item = timelineDataSet.get(lastMessage.id);
    if (item) {
      timeline.moveTo(item.start, { animation: animate });
    }
  };

  onMount(() => {
    let container = document.getElementsByClassName(
      `timeline timeline-${connectionId}`
    )![0] as HTMLElement;
    timelineDataSet = new DataSet<DataItem, "id">();
    const timelineData = getBoundedTimelineData($selectedTopicStore.history);
    timelineDataSet.add(timelineData);
    selectedTopicStore.setOnHistoryDelta(handleHistoryDelta);
    recomputeMin();
    defaultTimelineOptions = { ...defaultTimelineOptions, min: currentMin };
    timeline = new Timeline(container, timelineDataSet, defaultTimelineOptions);
    if (timelineDataSet.length > 0) {
      selectLastHistoryMessage(false);
    }

    timeline.setWindow(currentMin, maxTimelineTime, {
      animation: false,
    });

    timeline.on("select", (properties: { items: IdType[] }) => {
      if (properties.items.length === 0) {
        onMessageSelect(null);
        isAutoSelectingMostRecent = false;
        return;
      }
      const selectedId = properties.items[0];
      const selectedMessage = timelineDataSet.get(selectedId);
      const history = $selectedTopicStore.history;
      const messageIndex = history.findIndex(
        (message) => message.id === selectedId
      );
      const lastHistoryMessage = history[history.length - 1];
      if (!selectedId || !lastHistoryMessage || selectedId !== lastHistoryMessage.id) {
        isAutoSelectingMostRecent = false;
      }
      selectedMessageId = selectedId;
      selectedMessageIndex = messageIndex === -1 ? null : messageIndex;
      onMessageSelect(selectedId.toString());
      if (selectedMessage) {
        timeline.moveTo(selectedMessage.start, { animation: true });
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
        maxTimelineTime = moment().add(10, "minutes").toDate();
        applyTimelineOptions();
      },
      9 * 60 * 1000
    );
    // If eg. a laptop is closed, we don't want the timeline to not show the current time
    // once the app resumes. Only extend (and only then call setOptions, which
    // fully re-renders every item) once "now" gets within a minute of the
    // current max — comparing .getTime() (ms since epoch), not
    // .getMilliseconds() (0-999 sub-second component), which previously made
    // this condition true unconditionally and re-rendered the whole timeline
    // every second regardless of busyness.
    timelineEnsureNowVisibleInterval = setInterval(() => {
      const nowMs = new Date().getTime();
      if (nowMs > maxTimelineTime.getTime() - 60 * 1000) {
        maxTimelineTime = moment().add(10, "minutes").toDate();
        applyTimelineOptions();
      }
    }, 1000);
  });

  onDestroy(() => {
    destroyed = true;
    cancelPendingAppends();
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
    timelineDataSet = new DataSet<DataItem, "id">();
    timelineDataSet.add(getBoundedTimelineData($selectedTopicStore.history));
    selectedTopicStore.setOnHistoryDelta(handleHistoryDelta);
    timeline.setItems(timelineDataSet);
    recomputeMin();
    applyTimelineOptions();
    // Select the most recent message in the (re)loaded window by default.
    if (timelineDataSet.length > 0) {
      selectLastHistoryMessage(false);
    }
    timelineIsFocused = true;
    document.getElementById("timeline")?.focus();
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

  $: selectNextOrPreviousMessage = (action: "next" | "previous") => {
    if (!timeline || !timelineDataSet) return;
    if (selectedMessageId === null) return;
    const history = $selectedTopicStore.history;
    if (history.length === 0) return;
    // Derive the index from the selected id rather than trusting
    // selectedMessageIndex: prepends and trims shift every index in
    // `history`, so a stored index goes stale as soon as one happens.
    const currentIndex = history.findIndex(
      (message) => message.id === selectedMessageId
    );
    if (currentIndex === -1) return;
    let nextMessageIndex =
      action === "next" ? currentIndex + 1 : currentIndex - 1;
    if (nextMessageIndex < 0) {
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
      nextMessageIndex = history.length - 1;
    }
    if (nextMessageIndex >= history.length) {
      nextMessageIndex = 0;
    }
    const nextMessage = history[nextMessageIndex];
    selectedMessageId = nextMessage.id;
    selectedMessageIndex = nextMessageIndex;
    timeline.setSelection([nextMessage.id]);
    onMessageSelect(nextMessage.id.toString());
    const item = timelineDataSet.get(nextMessage.id);
    if (item) {
      timeline.moveTo(item.start, { animation: true });
    }
  };

  $: zoomIn = () => {
    timeline.zoomIn(1);
  };

  $: zoomOut = () => {
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

  .vis-item.vis-box.retained {
    background-color: var(--secondary);
  }

  .vis-item.vis-box.vis-selected {
    background-color: var(--primary-light);
    --tw-ring-opacity: 1;
    --tw-ring-color: rgb(119 136 252 / var(--tw-ring-opacity));
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
    border-color: black;
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
