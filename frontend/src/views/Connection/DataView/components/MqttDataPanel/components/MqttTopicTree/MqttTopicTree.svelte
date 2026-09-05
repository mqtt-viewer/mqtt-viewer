<script lang="ts">
  import MqttTopicRow from "./MqttTopicRow.svelte";
  //@ts-ignore
  import VirtualList from "@sveltejs/svelte-virtual-list";
  import type { MqttData } from "../../stores/mqtt-data";
  import type {
    MqttDataSortDirection,
    MqttDataSortKey,
  } from "../../stores/sort";
  import type { ExpandedTopicsStore } from "../../stores/expanded-topics";
  import _ from "lodash";
  import { buildTree, type TreeRow } from "./build-tree";
  import type { HighlightedMqttTopicsStore } from "../../stores/highlighted-topics";
  import { getConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import { OpenBrokerStatusWindow } from "bindings/mqtt-viewer/backend/app/app";
  import { findTopicNode } from "@/views/Connection/DataView/payload-copy";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import { tick } from "svelte";
  import { twMerge } from "tailwind-merge";

  const connectionId = getConnectionIdContext();

  export let width: number;
  export let selectedTopic: string | null;
  export let expandedTopicsStore: ExpandedTopicsStore;
  export let highlightedTopicStore: HighlightedMqttTopicsStore;
  export let mqttData: MqttData;
  export let searchText: string;
  export let sortKey: MqttDataSortKey;
  export let sortDir: MqttDataSortDirection;
  export let onTopicSelect: (topic: TreeRow) => void;
  /** Pinned topics for this connection, in pin order (newest last). */
  export let pinnedTopics: string[] = [];
  export let onUnpin: (topic: string) => void = () => {};
  export let onUnpinAll: () => void = () => {};

  const ROW_HEIGHT_PX = 19;

  $: pinnedSet = new Set(pinnedTopics);

  $: treeData = buildTree({
    data: mqttData,
    expandedTopics: $expandedTopicsStore,
    pinnedTopics: pinnedSet,
    sortKey,
    sortDir,
    searchText,
  });

  // Search deliberately does not filter the pinned block: a pin is a place you
  // put something so you can always see it, and a search that hid it would
  // defeat the point.
  $: pinnedRows = pinnedTopics.map((topic) => {
    const node = findTopicNode(mqttData, topic);
    return {
      topic,
      message: node?.message,
      messageCount: node?.messageCount ?? 0,
      subtopicCount: node?.subtopicCount ?? 0,
      isDecodedProto: node?.isDecodedProto ?? false,
      isRetained: node?.isRetained ?? false,
      hasNode: node !== null,
    };
  });

  // Component-local, not persisted: it is a scratch state you flick while
  // looking at something, not a preference.
  let isPinnedBlockCollapsed = false;

  let treeElement: HTMLDivElement | undefined;
  // The pinned block is capped at roughly two fifths of the panel, so a long
  // pin list can never crowd the tree out entirely. A percentage max-height
  // would not resolve here (the block's own parents are content-sized), hence
  // the measured pixel value.
  let panelHeight = 0;
  $: pinnedBodyMaxHeightPx = Math.max(
    ROW_HEIGHT_PX,
    Math.round(panelHeight * 0.4)
  );

  /**
   * Reveal a pinned branch in the tree below: expand every ancestor (and the
   * branch itself, so its children show), then scroll it into view.
   *
   * The virtual list has a fixed row height, so a row's offset is just its
   * index times that height. Nothing else in the list can be a different
   * height, which is what makes this safe.
   */
  const revealInTree = async (topic: string) => {
    const levels = topic.split("/");
    const ancestors: string[] = [];
    for (let i = 0; i < levels.length; i++) {
      ancestors.push(levels.slice(0, i + 1).join("/"));
    }
    expandedTopicsStore.expandMultipleTopics(ancestors);
    await tick();
    const index = treeData.findIndex((row) => row.topic === topic);
    if (index < 0) return;
    const viewport = treeElement?.querySelector(
      "svelte-virtual-list-viewport"
    ) as HTMLElement | null;
    if (!viewport) return;
    viewport.scrollTop = index * ROW_HEIGHT_PX;
  };

  const onPinnedRowClick = (row: (typeof pinnedRows)[number]) => {
    if (row.message !== undefined) {
      onTopicSelect({
        levelCount: 0,
        isDecodedProto: row.isDecodedProto,
        topicLevel: row.topic,
        topic: row.topic,
        expandKey: row.topic,
        isExpanded: false,
        countSubtopicTotal: row.subtopicCount,
        countMessage: row.messageCount,
        message: row.message,
        isRetained: row.isRetained,
        isPinned: true,
      });
      return;
    }
    revealInTree(row.topic);
  };
</script>

<div
  class="flex h-full min-h-0 w-full flex-col"
  bind:clientHeight={panelHeight}
>
  {#if pinnedTopics.length > 0}
  <!-- Sits above the virtual list rather than inside it: pinned topics have to
       stay put while the tree scrolls, which is the whole point of pinning
       them. Rows still carry data-topic, so the panel's single ContextMenu
       resolves right-clicks here exactly as it does in the tree. -->
  <div class="border-b border-b-outline">
    <div
      class="flex items-center gap-1 pr-2 text-xs text-secondary-text group"
      style:height={`${ROW_HEIGHT_PX}px`}
    >
      <button
        type="button"
        class="flex items-center gap-1"
        aria-label={isPinnedBlockCollapsed
          ? "Expand pinned topics"
          : "Collapse pinned topics"}
        on:click={() => (isPinnedBlockCollapsed = !isPinnedBlockCollapsed)}
      >
        <span class="w-4 flex justify-center">
          <span class={isPinnedBlockCollapsed ? "rotate-0" : "rotate-90"}>
            <Button variant="text" iconType="right" iconSize={14} />
          </span>
        </span>
        <span class="uppercase tracking-wide">Pinned</span>
        <span>({pinnedTopics.length})</span>
      </button>
      <div class="grow"></div>
      <button
        type="button"
        class={twMerge(
          "rounded px-1 hover:text-white-text hover:bg-hovered",
          "opacity-0 pointer-events-none",
          "group-hover:opacity-100 group-hover:pointer-events-auto",
          "focus-visible:opacity-100 focus-visible:pointer-events-auto"
        )}
        on:click={onUnpinAll}
      >
        Unpin all
      </button>
    </div>
    {#if !isPinnedBlockCollapsed}
      <div
        class="overflow-y-auto overscroll-none"
        style:max-height={`${pinnedBodyMaxHeightPx}px`}
      >
        {#each pinnedRows as row (row.topic)}
          <div class="flex" style:height={`${ROW_HEIGHT_PX}px`}>
            <div
              class="grow min-w-0 truncate"
              style:max-width={`${width - 8}px`}
            >
              {#if row.hasNode}
                <MqttTopicRow
                  topic={row.topic}
                  isDecodedProto={row.isDecodedProto}
                  isRetained={row.isRetained}
                  isPinned={true}
                  isSelected={selectedTopic === row.topic}
                  isExpanded={false}
                  topicLevel={row.topic}
                  expandKey={row.topic}
                  message={row.message}
                  subtopicCount={row.subtopicCount}
                  messageCount={row.messageCount}
                  showChevron={false}
                  toggleExpansion={() => {}}
                  onTopicSelect={() => onPinnedRowClick(row)}
                  onUnpin={() => onUnpin(row.topic)}
                  {highlightedTopicStore}
                />
              {:else}
                <!-- Pinned before anything arrived on the topic: a persisted
                     pin survives a restart, so the row has to exist before the
                     first message does. Same height as a real row so the block
                     does not jump when one lands. -->
                <div
                  data-topic={row.topic}
                  class="group flex items-center gap-2 px-1 min-w-0 select-none"
                  style:height={`${ROW_HEIGHT_PX}px`}
                >
                  <button
                    type="button"
                    aria-label="Unpin topic"
                    title="Unpin topic"
                    class={twMerge(
                      "inline-flex shrink-0 rounded text-secondary-text",
                      "opacity-60 hover:text-white-text group-hover:opacity-100",
                      "focus-visible:opacity-100"
                    )}
                    on:click|stopPropagation={() => onUnpin(row.topic)}
                  >
                    <Icon type="pin" size={10} />
                  </button>
                  <span class="font-mono font-thin truncate text-secondary-text"
                    >{row.topic}</span
                  >
                  <span class="text-xs text-secondary-text opacity-60 shrink-0"
                    >waiting for a message</span
                  >
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {/if}

  <div bind:this={treeElement} class="grow min-h-0">
  <VirtualList items={treeData} let:item itemHeight={ROW_HEIGHT_PX}>
    {@const marginLeftPx = item.levelCount * 18}
    {@const maxWidth = width - marginLeftPx - 8}
    <div class="flex">
      <div style:min-width={`${marginLeftPx}px`}></div>
      <div class="grow min-w-0 truncate" style:max-width={`${maxWidth}px`}>
        <MqttTopicRow
          topic={item.expandKey}
          isDecodedProto={item.isDecodedProto}
          isRetained={item.isRetained}
          isPinned={item.isPinned}
          isSelected={selectedTopic === item.topic}
          isExpanded={item.isExpanded}
          topicLevel={item.topicLevel}
          expandKey={item.expandKey}
          message={item.message}
          subtopicCount={item.countSubtopicTotal}
          messageCount={item.countMessage}
          toggleExpansion={expandedTopicsStore.toggleMqttTopicExpansion}
          onTopicSelect={() => onTopicSelect(item)}
          onOpenBrokerStatus={item.levelCount === 0 &&
          item.topicLevel === "$SYS"
            ? () => OpenBrokerStatusWindow(connectionId)
            : undefined}
          {highlightedTopicStore}
        />
      </div>
    </div>
    </VirtualList>
  </div>
</div>
