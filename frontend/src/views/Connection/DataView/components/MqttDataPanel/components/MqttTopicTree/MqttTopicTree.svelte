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
  import { buildPinnedRows, type PinnedBlockRow } from "./build-pinned-rows";
  import type { PinnedExpansionStore } from "@/views/Connection/DataView/stores/pinned-expansion";
  import type { HighlightedMqttTopicsStore } from "../../stores/highlighted-topics";
  import { getConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import { openBrokerStatusWindow } from "@/util/popout";
  import envStore from "@/stores/env";
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
  /**
   * Which topics are open inside the pinned block. Separate from
   * expandedTopicsStore so the block and the tree open independently, and
   * owned by DataView so it outlives this component.
   */
  export let pinnedExpansionStore: PinnedExpansionStore;

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

  // Search deliberately does not filter the pinned block, children included:
  // see buildPinnedRows.
  $: pinnedRows = buildPinnedRows({
    data: mqttData,
    pinnedTopics,
    pinnedSet,
    expandedTopics: $pinnedExpansionStore,
    sortKey,
    sortDir,
  });

  // The pinned block is its own virtual list, sized to its rows up to two
  // fifths of the panel (header included) so a long pin list or a big opened
  // branch can never crowd the tree out. Until the first layout there is no
  // height to take two fifths of, so it starts at a modest cap rather than
  // letting the list render every row for a frame.
  let containerHeight = 0;
  $: pinnedBodyCap =
    containerHeight > 0
      ? Math.max(
          ROW_HEIGHT_PX,
          Math.floor(containerHeight * 0.4) - ROW_HEIGHT_PX
        )
      : 10 * ROW_HEIGHT_PX;
  $: pinnedBodyHeight = Math.min(
    pinnedRows.length * ROW_HEIGHT_PX,
    pinnedBodyCap
  );

  // The virtual list keeps its scroll window when its items shrink. Collapse a
  // branch (or unpin, or clear the data) while scrolled past where the list
  // now ends and it would go on rendering a window that no longer exists: a
  // blank block. Pulling the scroll back inside the new extent makes the list
  // recompute its window. Only a shrink can strand it, so growth, which is
  // every message batch on a busy broker, costs nothing here.
  let pinnedBodyElement: HTMLDivElement | undefined;
  let lastPinnedRowCount = 0;
  const clampPinnedScroll = async () => {
    await tick();
    const viewport = pinnedBodyElement?.querySelector(
      "svelte-virtual-list-viewport"
    ) as HTMLElement | null;
    if (!viewport) return;
    const maxScrollTop = Math.max(
      0,
      pinnedRows.length * ROW_HEIGHT_PX - pinnedBodyHeight
    );
    if (viewport.scrollTop > maxScrollTop) viewport.scrollTop = maxScrollTop;
  };
  $: if (pinnedRows.length !== lastPinnedRowCount) {
    if (pinnedRows.length < lastPinnedRowCount) clampPinnedScroll();
    lastPinnedRowCount = pinnedRows.length;
  }

  // Component-local, not persisted: it is a scratch state you flick while
  // looking at something, not a preference.
  let isPinnedBlockCollapsed = false;

  // Every row in the block, pin or descendant, acts like a tree row: a click
  // opens its message if it has one, otherwise it opens the branch. The branch
  // opens here, in the block, rather than in the tree, so the label and the
  // chevron beside it always do the same thing.
  const onPinnedRowClick = (row: TreeRow & { kind: "pin" | "descendant" }) => {
    if (row.message !== undefined) {
      onTopicSelect(row);
      return;
    }
    if (row.countSubtopicTotal > 0) pinnedExpansionStore.toggle(row.topic);
  };

  // VirtualList is untyped, so its slot item arrives as any.
  const asPinnedRow = (item: any) => item as PinnedBlockRow;
</script>

<div
  class="flex h-full min-h-0 w-full flex-col"
  bind:clientHeight={containerHeight}
>
  {#if pinnedTopics.length > 0}
    <!-- Sits above the tree's virtual list rather than inside it: pinned
         topics have to stay put while the tree scrolls, which is the whole
         point of pinning them. Rows still carry data-topic, so the panel's
         single ContextMenu resolves right-clicks here exactly as it does in
         the tree, descendants included. -->
    <div class="flex shrink-0 flex-col border-b border-b-outline">
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
        <!-- Virtualised like the tree: an opened branch can run to thousands
             of rows, and every one would otherwise re-render per message
             batch. Every row is the same fixed height, placeholder included,
             which the list depends on. -->
        <div bind:this={pinnedBodyElement} style:height={`${pinnedBodyHeight}px`}>
          <VirtualList
            items={pinnedRows}
            height={`${pinnedBodyHeight}px`}
            itemHeight={ROW_HEIGHT_PX}
            let:item
          >
            {@const row = asPinnedRow(item)}
            {#if row.kind === "placeholder"}
              <!-- Pinned before anything arrived on the topic: a persisted
                   pin survives a restart, so the row has to exist before the
                   first message does. Deliberately the same shape as
                   MqttTopicRow: the same empty 16px chevron slot, the same
                   px-1, the topic path first in the same mono/semibold/white,
                   then the pin button in the same spot at the same size, so
                   nothing shifts when a message lands and the row becomes a
                   real one. Same height too, so the block does not jump. -->
              <div
                data-topic={row.topic}
                class={twMerge(
                  "group flex min-w-0 select-none items-center",
                  "font-mono font-thin text-secondary-text"
                )}
                style:height={`${ROW_HEIGHT_PX}px`}
                style:max-width={`${width - 8}px`}
              >
                <div class="w-4 shrink-0"></div>
                <div class="flex min-w-0 items-center px-1">
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
              </div>
            {:else}
              {@const marginLeftPx = row.levelCount * 18}
              <!-- Pinned to the row height: a MqttTopicRow can lay out half a
                   pixel taller, and in a body sized to exactly its rows that
                   half pixel per row adds up to a stray scrollbar. -->
              <div class="flex overflow-hidden" style:height={`${ROW_HEIGHT_PX}px`}>
                <div style:min-width={`${marginLeftPx}px`}></div>
                <div
                  class="grow min-w-0 truncate"
                  style:max-width={`${width - marginLeftPx - 8}px`}
                >
                  <MqttTopicRow
                    topic={row.topic}
                    isDecodedProto={row.isDecodedProto}
                    isRetained={row.isRetained}
                    isPinned={row.isPinned}
                    isSelected={selectedTopic === row.topic}
                    isExpanded={row.isExpanded}
                    topicLevel={row.topicLevel}
                    expandKey={row.expandKey}
                    message={row.message}
                    subtopicCount={row.countSubtopicTotal}
                    messageCount={row.countMessage}
                    toggleExpansion={pinnedExpansionStore.toggle}
                    onTopicSelect={() => onPinnedRowClick(row)}
                    onUnpin={row.isPinned ? () => onUnpin(row.topic) : undefined}
                    {highlightedTopicStore}
                  />
                </div>
              </div>
            {/if}
          </VirtualList>
        </div>
      {/if}
    </div>
  {/if}

  <div class="grow min-h-0">
    <VirtualList items={treeData} let:item itemHeight={ROW_HEIGHT_PX}>
      {@const marginLeftPx = item.levelCount * 18}
      {@const maxWidth = width - marginLeftPx - 8}
      <div class="flex">
        <div style:min-width={`${marginLeftPx}px`}></div>
        <div class="grow min-w-0 truncate" style:max-width={`${maxWidth}px`}>
          <!-- ponytail: restore in web mode when broker status has an in-page route. -->
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
            onOpenBrokerStatus={!$envStore.isServerMode &&
            item.levelCount === 0 &&
            item.topicLevel === "$SYS"
              ? () => openBrokerStatusWindow(connectionId)
              : undefined}
            onUnpin={item.isPinned ? () => onUnpin(item.topic) : undefined}
            {highlightedTopicStore}
          />
        </div>
      </div>
    </VirtualList>
  </div>
</div>
