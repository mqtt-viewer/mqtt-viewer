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
  import type {
    MqttHistoryMessage,
    SelectedTopicStore,
  } from "../../../stores/selected-topic-store";
  import Icon from "@/components/Icon/Icon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";

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

  onMount(() => {
    let container = document.getElementsByClassName(
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

    timeline.on("select", (properties: { items: IdType[] }) => {
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

  $: $selectedTopicStore.selectedTopic,
    (() => {
      if (!timeline || $selectedTopicStore.selectedTopic === "") return;
      if (innerSelectedTopic === $selectedTopicStore.selectedTopic) return;
      innerSelectedTopic = $selectedTopicStore.selectedTopic;
      timelineDataSet = new DataSet<DataItem, "id">();
      const timelineData = getTimelineData($selectedTopicStore.history);
      timelineDataSet.add(timelineData);
      selectedTopicStore.setOnNewMessages((messages) => {
        timelineDataSet.add(getTimelineData(messages));
      });
      timeline.setItems(timelineDataSet);

      // Select the most recent message if it exists by default
      if (timelineDataSet.length > 0) {
        const lastMessage = timelineDataSet.get()[timelineDataSet.length - 1];
        timeline.setSelection([lastMessage.id]);
        onMessageSelect(lastMessage.id.toString());
        timeline.moveTo(lastMessage.start, { animation: true });
      }
      timelineIsFocused = true;
      document.getElementById("timeline")?.focus();
    })();

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

  $: onKeypress = (
    event: KeyboardEvent & {
      currentTarget: EventTarget;
    }
  ) => {
    if (event.code === "KeyD" || event.code === "ArrowRight") {
      selectNextOrPreviousMessage("next");
    } else if (event.code === "KeyA" || event.code === "ArrowLeft") {
      selectNextOrPreviousMessage("previous");
    } else if (event.code === "KeyW" || event.code === "ArrowUp") {
      zoomIn();
    } else if (event.code === "KeyS" || event.code === "ArrowDown") {
      zoomOut();
    }
    if (
      event.code === "KeyA" ||
      event.code === "ArrowLeft" ||
      event.code === "KeyD" ||
      event.code === "ArrowRight"
    ) {
      isAutoSelectingMostRecent = false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
</script>

<!-- <svelte:window on:keypress={onKeypress} /> -->
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
  on:keypress={onKeypress}
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
      text="Use W-A-S-D to select messages and zoom"
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
    border-color: rgb(46, 46, 46);
  }

  .vis-panel.vis-center {
    border-width: 0.5px;
    border-color: rgb(46, 46, 46);
  }

  .vis-panel.vis-bottom {
    border-width: 0.5px;
    border-color: rgb(46, 46, 46);
  }
</style>
