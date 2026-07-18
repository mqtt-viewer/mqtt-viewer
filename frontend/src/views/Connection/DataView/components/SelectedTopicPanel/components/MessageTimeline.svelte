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
  import type {
    MqttHistoryMessage,
    SelectedTopicStore,
  } from "../../../stores/selected-topic-store";
  import Icon from "@/components/Icon/Icon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import { previewPayload } from "./hover-preview";

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

  // The timeline's DOM host, shared by onMount and rebuilds so hover
  // positioning can measure it.
  let container: HTMLElement;

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
  const POPOVER_MARGIN = 8;

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

  const hideHover = () => {
    hoveredMessage = null;
    popoverPositioned = false;
  };

  const positionPopover = () => {
    if (!container || !popoverEl) return;
    const cw = container.clientWidth;
    const pw = popoverEl.offsetWidth;
    const ph = popoverEl.offsetHeight;
    // Centre horizontally on the cursor, clamped inside the container.
    let left = hoverMouseX - pw / 2;
    left = Math.max(POPOVER_MARGIN, Math.min(left, cw - pw - POPOVER_MARGIN));
    // Place above the marker, flipping below when there isn't room.
    let top = hoverMouseY - ph - POPOVER_MARGIN;
    if (top < POPOVER_MARGIN) {
      top = hoverMouseY + POPOVER_MARGIN;
    }
    popoverLeft = left;
    popoverTop = top;
    popoverPositioned = true;
  };

  const showHover = async (messageId: string, event: MouseEvent) => {
    // Cancel any debounced hide from a spurious itemout.
    if (hideHoverTimeout) {
      clearTimeout(hideHoverTimeout);
      hideHoverTimeout = null;
    }
    // Look the full message up directly; the vis dataset doesn't carry
    // payload/qos/retain.
    const message = $selectedTopicStore.history.find((m) => m.id === messageId);
    // Guard against a hovered id that's no longer in the window (eviction).
    if (!message || !container) {
      hideHover();
      return;
    }
    const rect = container.getBoundingClientRect();
    hoverMouseX = event.clientX - rect.left;
    hoverMouseY = event.clientY - rect.top;
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
    // Wait for the popover to render before measuring it.
    await tick();
    positionPopover();
  };

  onMount(() => {
    container = document.getElementsByClassName(
      `timeline timeline-${connectionId}`
    )![0] as HTMLElement;
    timelineDataSet = new DataSet<DataItem, "id">();
    const timelineData = getTimelineData($selectedTopicStore.history);
    timelineDataSet.add(timelineData);
    selectedTopicStore.setOnNewMessages((messages) => {
      timelineDataSet.add(getTimelineData(messages));
    });
    timeline = new Timeline(container, timelineDataSet, defaultTimelineOptions);
    if (timelineDataSet.length > 0) {
      const lastMessage = timelineDataSet.get()[timelineDataSet.length - 1];
      selectedMessageId = lastMessage.id;
      selectedMessageIndex = timelineDataSet.length - 1;
      timeline.setSelection([lastMessage.id]);
      onMessageSelect(lastMessage.id.toString());
    }

    timeline.setWindow(minTimelineTime, maxTimelineTime, {
      animation: false,
    });

    // Hover is a pure preview: show the full message on itemover, hide on
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
      const messageIndex = timelineDataSet
        .get()
        .findIndex((message) => message.id === selectedId);
      const lastMessageId =
        timelineDataSet.get()[timelineDataSet.length - 1].id;
      if (!selectedId || selectedId !== lastMessageId) {
        isAutoSelectingMostRecent = false;
      }
      selectedMessageId = selectedId;
      selectedMessageIndex = messageIndex;
      onMessageSelect(selectedId.toString());
      if (selectedMessage) {
        timeline.moveTo(selectedMessage.start, { animation: true });
      }
    });

    timelineUpdateMaxInteral = setInterval(
      () => {
        maxTimelineTime = moment().add(10, "minutes").toDate();
        timeline.setOptions({
          ...defaultTimelineOptions,
          max: maxTimelineTime,
        });
      },
      9 * 60 * 1000
    );
    // If eg. a laptop is closed, we don't want the timeline to not show the current time
    // once the app resumes
    timelineEnsureNowVisibleInterval = setInterval(() => {
      if (maxTimelineTime.getMilliseconds() < new Date().getTime()) {
        maxTimelineTime = moment().add(10, "minutes").toDate();
        timeline.setOptions({
          ...defaultTimelineOptions,
          max: maxTimelineTime,
        });
      }
    }, 1000);
  });

  onDestroy(() => {
    if (hideHoverTimeout) {
      clearTimeout(hideHoverTimeout);
      hideHoverTimeout = null;
    }
    hideHover();
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
    selectedTopicStore.setOnNewMessages(null);
  });

  const turnAutoSelectMostRecentOn = (
    timeline: Timeline,
    timelineDataSet: DataSet<DataItem, "id">
  ) => {
    if (!timelineDataSet || !timeline) return;
    const lastMessage = timelineDataSet.get()[timelineDataSet.length - 1];
    if (lastMessage) {
      selectedMessageId = lastMessage.id;
      selectedMessageIndex = timelineDataSet.length - 1;
      timeline.setSelection([lastMessage.id]);
      onMessageSelect(lastMessage.id.toString());
      timeline.moveTo(lastMessage.start, { animation: true });
    }
    timelineDataSet.on("add", selectMostRecentData);
  };

  const turnAutoSelectMostRecentOff = (
    timelineDataSet: DataSet<DataItem, "id">
  ) => {
    if (!timelineDataSet || !timeline) return;
    timelineDataSet.off("add", selectMostRecentData);
  };

  const selectMostRecentData = (
    event: "add",
    properties: { items: IdType[] },
    senderId: string
  ) => {
    if (properties.items.length === 0) return;
    const lastMessageId = properties.items[properties.items.length - 1];
    selectedMessageId = lastMessageId;
    selectedMessageIndex = timelineDataSet.length - 1;
    timeline.setSelection([lastMessageId]);
    onMessageSelect(lastMessageId.toString());
    const lastMessage = timelineDataSet.get(lastMessageId);
    if (lastMessage) {
      timeline.moveTo(lastMessage.start, { animation: true });
    }
  };

  $: isAutoSelectingMostRecent,
    (() => {
      if (!timeline || !timelineDataSet) return;
      if (!isAutoSelectingMostRecent) {
        turnAutoSelectMostRecentOff(timelineDataSet);
      } else {
        turnAutoSelectMostRecentOn(timeline, timelineDataSet);
      }
    })();

  let innerSelectedTopic = $selectedTopicStore.selectedTopic;
  // Tracks the loaded history window so a window switch (same topic, replaced
  // history) rebuilds the dataset. Live appends keep the same oldestId, so
  // they don't trigger a rebuild.
  let innerWindowOldestId = $selectedTopicStore.window?.oldestId ?? null;

  const rebuildTimelineFromHistory = () => {
    hideHover();
    timelineDataSet = new DataSet<DataItem, "id">();
    timelineDataSet.add(getTimelineData($selectedTopicStore.history));
    selectedTopicStore.setOnNewMessages((messages) => {
      timelineDataSet.add(getTimelineData(messages));
    });
    timeline.setItems(timelineDataSet);
    // Select the most recent message in the (re)loaded window by default.
    if (timelineDataSet.length > 0) {
      const lastMessage = timelineDataSet.get()[timelineDataSet.length - 1];
      timeline.setSelection([lastMessage.id]);
      onMessageSelect(lastMessage.id.toString());
      timeline.moveTo(lastMessage.start, { animation: true });
    }
    timelineIsFocused = true;
    document.getElementById("timeline")?.focus();
  };

  $: {
    const topic = $selectedTopicStore.selectedTopic;
    const windowOldestId = $selectedTopicStore.window?.oldestId ?? null;
    if (timeline && topic !== "" && topic !== null) {
      if (
        innerSelectedTopic !== topic ||
        innerWindowOldestId !== windowOldestId
      ) {
        innerSelectedTopic = topic;
        innerWindowOldestId = windowOldestId;
        rebuildTimelineFromHistory();
      }
    }
  }

  $: selectNextOrPreviousMessage = (action: "next" | "previous") => {
    if (!timeline || !timelineDataSet) return;
    if (selectedMessageIndex === null) return;
    let nextMessageIndex =
      action === "next" ? selectedMessageIndex + 1 : selectedMessageIndex - 1;
    if (nextMessageIndex >= timelineDataSet.length) {
      nextMessageIndex = 0;
    }
    if (nextMessageIndex < 0) {
      nextMessageIndex = timelineDataSet.length - 1;
    }
    const nextMessage = timelineDataSet.get()[nextMessageIndex];
    selectedMessageId = nextMessage.id;
    selectedMessageIndex = nextMessageIndex;
    timeline.setSelection([nextMessage.id]);
    onMessageSelect(nextMessage.id.toString());
    timeline.moveTo(nextMessage.start, { animation: true });
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

  {#if hoveredMessage}
    <div
      bind:this={popoverEl}
      class={`
        pointer-events-none absolute z-20 max-w-[320px]
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
      <div
        class="mt-1 font-mono whitespace-pre-wrap break-all
          max-h-[140px] overflow-hidden line-clamp-[8]"
      >
        {previewPayload(hoveredMessage.payload)}
      </div>
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
    background-color: var(--primary);
    opacity: 0.55;
  }

  .vis-item.vis-box.vis-selected,
  .vis-item.vis-box.retained {
    opacity: 1;
  }

  .vis-item.vis-box.retained {
    background-color: var(--secondary);
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
