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

  /**
   * Reveal a pinned branch in the tree below: expand every ancestor (and the
   * branch itself, so its children show), then scroll it into view.
   *
   * The virtual list has a fixed row height, so a row's offset is just its
   * index times that height. Nothing else in the list can be a different
   * height, which is what makes this safe.
   *
   * A search filter can prune the topic out of the tree entirely, in which
   * case there is nothing to reveal and the expansions are undone: leaving
   * half a broker's branches open after a click that visibly did nothing is
   * worse than the click doing nothing at all.
   */
  const revealInTree = async (topic: string) => {
    const levels = topic.split("/");
    const ancestors: string[] = [];
    for (let i = 0; i < levels.length; i++) {
      ancestors.push(levels.slice(0, i + 1).join("/"));
    }
    // Only the keys this reveal adds are ours to take back; anything the user
    // had already opened stays open.
    const opened = ancestors.filter((key) => !$expandedTopicsStore.has(key));
    expandedTopicsStore.expandMultipleTopics(ancestors);
    await tick();
    const index = treeData.findIndex((row) => row.topic === topic);
    if (index < 0) {
      if (opened.length > 0) expandedTopicsStore.collapseMultipleTopics(opened);
      return;
    }
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

<div class="flex h-full min-h-0 w-full flex-col">
  {#if pinnedTopics.length > 0}
    <!-- Sits above the virtual list rather than inside it: pinned topics have to
         stay put while the tree scrolls, which is the whole point of pinning
         them. Rows still carry data-topic, so the panel's single ContextMenu
         resolves right-clicks here exactly as it does in the tree. -->
    <!-- Capped at two fifths of the panel so a long pin list can never crowd
         the tree out entirely; the body scrolls past that. -->
    <div class="flex max-h-[40%] min-h-0 flex-col border-b border-b-outline">
      <div
        class="flex shrink-0 items-center gap-1 pr-2 text-xs text-secondary-text group"
        style:height={`${ROW_HEIGHT_PX}px`}
      >
        <button
          type="button"
          class={twMerge(
            "flex items-center gap-1 rounded hover:text-emphasis",
            "focus-visible:ring-1 focus-visible:ring-primary"
          )}
          aria-label={isPinnedBlockCollapsed
            ? "Expand pinned topics"
            : "Collapse pinned topics"}
          on:click={() => (isPinnedBlockCollapsed = !isPinnedBlockCollapsed)}
        >
          <span class="w-4 flex justify-center">
            <span class={isPinnedBlockCollapsed ? "rotate-0" : "rotate-90"}>
              <Icon type="right" size={14} />
            </span>
          </span>
          <span class="uppercase tracking-wide">Pinned</span>
          <span>({pinnedTopics.length})</span>
        </button>
        <div class="grow"></div>
        <button
          type="button"
          class={twMerge(
            "rounded px-1 hover:text-emphasis hover:bg-hovered",
            "opacity-0 pointer-events-none",
            "group-hover:opacity-100 group-hover:pointer-events-auto",
            "focus-visible:opacity-100 focus-visible:pointer-events-auto",
            "focus-visible:ring-1 focus-visible:ring-primary"
          )}
          on:click={onUnpinAll}
        >
          Unpin all
        </button>
      </div>
      {#if !isPinnedBlockCollapsed}
        <div class="min-h-0 overflow-y-auto overscroll-none">
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
                       first message does. Deliberately the same shape as
                       MqttTopicRow: same px-1, the topic path first in the same
                       mono/semibold/white, then the pin button in the same spot
                       at the same size, so nothing shifts when a message lands
                       and the row becomes a real one. Same height too, so the
                       block does not jump. -->
                  <div
                    data-topic={row.topic}
                    class={twMerge(
                      "group flex min-w-0 select-none items-center px-1",
                      "font-mono font-thin text-secondary-text"
                    )}
                    style:height={`${ROW_HEIGHT_PX}px`}
                  >
                    <p class="mr-2 truncate font-semibold text-white-text">
                      {row.topic}
                    </p>
                    <button
                      type="button"
                      aria-label="Unpin topic"
                      title="Unpin topic"
                      class={twMerge(
                        "mr-2 inline-flex shrink-0 self-center rounded",
                        "text-secondary-text hover:text-emphasis",
                        "opacity-60 group-hover:opacity-100",
                        "focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-primary"
                      )}
                      on:click|stopPropagation={() => onUnpin(row.topic)}
                    >
                      <Icon type="pin" size={10} />
                    </button>
                    <span class="shrink-0 text-xs text-secondary-text"
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
            onUnpin={item.isPinned ? () => onUnpin(item.topic) : undefined}
            {highlightedTopicStore}
          />
        </div>
      </div>
    </VirtualList>
  </div>
</div>
