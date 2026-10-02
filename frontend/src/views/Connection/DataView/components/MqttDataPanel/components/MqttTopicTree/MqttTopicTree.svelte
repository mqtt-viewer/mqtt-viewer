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
  import {
    pinnedBodyBounds,
    pinnedBodyCap,
    pinnedBodyHeight as bodyHeightFor,
    resizedBodyCap,
  } from "./pinned-block-size";
  import {
    createShrinkClamp,
    findVirtualListViewport,
    maxScrollTop,
  } from "./virtual-list-scroll";
  import type { PinnedExpansionStore } from "@/views/Connection/DataView/stores/pinned-expansion";
  import type { HighlightedMqttTopicsStore } from "../../stores/highlighted-topics";
  import { getConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import { openBrokerStatusWindow } from "@/util/popout";
  import envStore from "@/stores/env";
  import Icon from "@/components/Icon/Icon.svelte";
  import { onDestroy, tick } from "svelte";
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
   * Which topics are open inside the pinned block, per pin. Separate from
   * expandedTopicsStore so the block and the tree open independently, and
   * owned by DataView so it outlives this component.
   */
  export let pinnedExpansionStore: PinnedExpansionStore;
  /**
   * The height cap the user dragged the pinned block's body to, in px, or
   * null for the default (two fifths of the panel, block included). Clamped
   * to the panel here, never rewritten by the clamp.
   */
  export let pinnedBodyCapPx: number | null = null;
  /** Called when the user drags or resets the cap; null means the default. */
  export let onPinnedBodyCapChange: (capPx: number | null) => void = () => {};

  const ROW_HEIGHT_PX = 19;
  // The divider under the block (its border-b).
  const PINNED_BORDER_PX = 1;

  $: pinnedSet = new Set(pinnedTopics);

  $: treeData = buildTree({
    data: mqttData,
    expandedTopics: $expandedTopicsStore,
    pinnedTopics: pinnedSet,
    sortKey,
    sortDir,
    searchText,
  });

  // Filtered by the search exactly as the tree is: see buildPinnedRows.
  $: pinnedRows = buildPinnedRows({
    data: mqttData,
    pinnedTopics,
    pinnedSet,
    expansion: $pinnedExpansionStore,
    sortKey,
    sortDir,
    searchText,
  });

  // While a search is on, the header says how many pins it kept, so pins it
  // hides never look as if they had gone. Counted only while searching.
  $: matchedPinCount = searchText
    ? pinnedRows.reduce((n, row) => (row.kind === "descendant" ? n : n + 1), 0)
    : pinnedTopics.length;

  // The pinned block is its own virtual list, sized to its rows up to a cap
  // so a long pin list or a big opened branch never crowds the tree out. The
  // cap is the user's (dragged on the divider) or two fifths of the panel,
  // either way clamped so the tree keeps a few rows.
  let containerHeight = 0;
  // Local so a drag paints at once; follows the prop whenever it changes.
  let preferredBodyCap: number | null = pinnedBodyCapPx;
  $: preferredBodyCap = pinnedBodyCapPx;
  $: pinnedBounds = pinnedBodyBounds({
    containerHeight,
    rowHeight: ROW_HEIGHT_PX,
    headerHeight: ROW_HEIGHT_PX,
    borderHeight: PINNED_BORDER_PX,
  });
  $: pinnedCap = pinnedBodyCap(preferredBodyCap, pinnedBounds);
  $: pinnedBodyHeight = bodyHeightFor(
    pinnedRows.length,
    ROW_HEIGHT_PX,
    pinnedCap
  );

  // Component-local, not persisted: it is a scratch state you flick while
  // looking at something, not a preference.
  let isPinnedBlockCollapsed = false;

  // Both lists keep their scroll window when their rows shrink, which strands
  // them on a blank window: see createShrinkClamp. Each is also unmounted
  // while it has no rows at all, the one shrink a scroll cannot undo.
  let pinnedBodyElement: HTMLDivElement | undefined;
  let treeElement: HTMLDivElement | undefined;
  const onPinnedRowCount = createShrinkClamp(
    () => pinnedBodyElement,
    ROW_HEIGHT_PX
  );
  const onTreeRowCount = createShrinkClamp(() => treeElement, ROW_HEIGHT_PX);
  $: onPinnedRowCount(pinnedRows.length);
  $: onTreeRowCount(treeData.length);

  // Every row in the block, pin or descendant, acts like a tree row: a click
  // opens its message if it has one, otherwise it opens the branch. The branch
  // opens here, in the block, rather than in the tree, so the label and the
  // chevron beside it always do the same thing.
  const onPinnedRowClick = (
    row: TreeRow & { kind: "pin" | "descendant"; pinRoot: string }
  ) => {
    if (row.message !== undefined) {
      onTopicSelect(row);
      return;
    }
    if (row.countSubtopicTotal > 0) {
      pinnedExpansionStore.toggle(row.pinRoot, row.topic);
    }
  };

  // Resizing the block from the divider under it. Pointer capture keeps the
  // drag on the handle wherever the pointer goes, so it never selects text
  // and its release never lands as a click on a row.
  let isResizingPinned = false;
  const setPinnedCap = (capPx: number | null, persist: boolean) => {
    const previous = preferredBodyCap;
    preferredBodyCap =
      capPx === null
        ? null
        : resizedBodyCap({
            desired: capPx,
            rowHeight: ROW_HEIGHT_PX,
            contentHeight: pinnedRows.length * ROW_HEIGHT_PX,
            cap: pinnedCap,
            preferred: preferredBodyCap,
            bounds: pinnedBounds,
          });
    if (persist && preferredBodyCap !== previous) {
      onPinnedBodyCapChange(preferredBodyCap);
    }
  };

  const onResizePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    // From what is on screen, not the cap: with fewer rows than the cap the
    // block would otherwise not move until the drag had covered the gap.
    const startY = event.clientY;
    const startHeight = pinnedBodyHeight;
    const startPreference = preferredBodyCap;
    isResizingPinned = true;
    const onMove = (e: PointerEvent) => {
      setPinnedCap(startHeight + e.clientY - startY, false);
    };
    // lostpointercapture as well as up and cancel: it is the one that still
    // fires when the capture goes without either, which would otherwise leave
    // the resize cursor stuck on the whole panel.
    const endEvents = ["pointerup", "pointercancel", "lostpointercapture"];
    const onEnd = () => {
      if (!isResizingPinned) return;
      handle.removeEventListener("pointermove", onMove);
      for (const type of endEvents) handle.removeEventListener(type, onEnd);
      isResizingPinned = false;
      // Persist the deliberate end of a drag only, never each frame, and not
      // a click that moved nothing.
      if (preferredBodyCap !== startPreference) {
        onPinnedBodyCapChange(preferredBodyCap);
      }
    };
    handle.addEventListener("pointermove", onMove);
    for (const type of endEvents) handle.addEventListener(type, onEnd);
  };

  const onResizeKeydown = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp") {
      setPinnedCap(pinnedBodyHeight - ROW_HEIGHT_PX, true);
    } else if (event.key === "ArrowDown") {
      setPinnedCap(pinnedBodyHeight + ROW_HEIGHT_PX, true);
    } else if (event.key === "Enter") {
      setPinnedCap(null, true);
    } else {
      return;
    }
    event.preventDefault();
  };

  /**
   * Show a topic in the tree below: open every ancestor, then scroll the
   * tree so its row is in view. The topic itself stays as it was, so a
   * branch shows where it is rather than spilling its children.
   *
   * A search filter can prune the topic out of the tree entirely, in which
   * case there is nothing to show and the ancestors this opened are closed
   * again: leaving half a broker's branches open after a click that visibly
   * did nothing is worse than the click doing nothing at all.
   */
  export const revealInTree = async (topic: string) => {
    const levels = topic.split("/");
    const ancestors = levels
      .slice(0, -1)
      .map((_level, i) => levels.slice(0, i + 1).join("/"));
    // Only the keys this opens are ours to take back; anything the user had
    // already opened stays open.
    const opened = ancestors.filter((key) => !$expandedTopicsStore.has(key));
    if (opened.length > 0) expandedTopicsStore.expandMultipleTopics(opened);
    await tick();
    const index = treeData.findIndex((row) => row.topic === topic);
    if (index < 0) {
      if (opened.length > 0) expandedTopicsStore.collapseMultipleTopics(opened);
      return;
    }
    await scrollTreeRowIntoView(index);
    markRevealed(topic);
  };

  // The row just shown wears the selection ring for a moment, so the eye
  // lands on it: opening its ancestors can move a screenful of rows at once,
  // and a row that was already in view would otherwise not change at all.
  const REVEAL_MARK_MS = 1600;
  let revealedTopic: string | null = null;
  let revealMarkTimeout: ReturnType<typeof setTimeout> | undefined;
  const markRevealed = (topic: string) => {
    clearTimeout(revealMarkTimeout);
    revealedTopic = topic;
    revealMarkTimeout = setTimeout(() => (revealedTopic = null), REVEAL_MARK_MS);
  };
  onDestroy(() => clearTimeout(revealMarkTimeout));

  // Every row is the same fixed height, so a row's offset is its index times
  // that height. The list grows its scroll extent for newly opened rows a few
  // microtasks after they arrive, and the browser clamps a scrollTop set
  // before then, so the scroll is retried on the next frames until it holds.
  const scrollTreeRowIntoView = async (index: number) => {
    const viewport = findVirtualListViewport(treeElement);
    if (!viewport) return;
    const rowTop = index * ROW_HEIGHT_PX;
    const viewportHeight = viewport.clientHeight;
    const isInView =
      rowTop >= viewport.scrollTop &&
      rowTop + ROW_HEIGHT_PX <= viewport.scrollTop + viewportHeight;
    if (isInView) return;
    const target = Math.min(
      Math.max(0, rowTop - Math.floor((viewportHeight - ROW_HEIGHT_PX) / 2)),
      maxScrollTop(treeData.length, ROW_HEIGHT_PX, viewportHeight)
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      // The list only learns the heights of rows it has rendered or scrolled
      // past. Jump over rows it has never seen and its next scroll-up sums
      // their unknown heights into NaN and snaps to the top. A scroll event
      // where it stands makes it fill in every row ahead before the jump.
      viewport.dispatchEvent(new Event("scroll"));
      viewport.scrollTop = target;
      if (Math.abs(viewport.scrollTop - target) < 1) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  };

  // VirtualList is untyped, so its slot item arrives as any.
  const asPinnedRow = (item: any) => item as PinnedBlockRow;
</script>

<div
  class={twMerge(
    "flex h-full min-h-0 w-full flex-col",
    isResizingPinned && "cursor-row-resize"
  )}
  bind:clientHeight={containerHeight}
>
  {#if pinnedTopics.length > 0}
    <!-- Sits above the tree's virtual list rather than inside it: pinned
         topics have to stay put while the tree scrolls, which is the whole
         point of pinning them. Rows still carry data-topic, so the panel's
         single ContextMenu resolves right-clicks here exactly as it does in
         the tree, descendants included; data-pinned-block tells it the
         right-click came from here, which is what offers "Show in tree". -->
    <div
      data-pinned-block
      class="relative flex shrink-0 flex-col border-b border-b-outline"
    >
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
          <span>
            ({searchText
              ? `${matchedPinCount} of ${pinnedTopics.length}`
              : pinnedTopics.length})
          </span>
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
      <!-- With no rows (a search that matches no pin) the body goes rather
           than rendering empty, which also remounts the list fresh when rows
           come back. -->
      {#if !isPinnedBlockCollapsed && pinnedRows.length > 0}
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
                  <!-- Expansion toggles under this row's own pin, so a topic
                       shown under two pins opens in one without the other.
                       expandKey stays the topic: it keys the flash highlight,
                       which is the topic's wherever it shows. -->
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
                    toggleExpansion={() =>
                      pinnedExpansionStore.toggle(row.pinRoot, row.topic)}
                    onTopicSelect={() => onPinnedRowClick(row)}
                    onUnpin={row.isPinned ? () => onUnpin(row.topic) : undefined}
                    {highlightedTopicStore}
                  />
                </div>
              </div>
            {/if}
          </VirtualList>
        </div>
        <!-- The divider is the resize handle. Absolutely placed over the
             border so its hit area, a few px either side of the line, never
             shifts the layout. Shown only while the body is, since there is
             nothing to resize otherwise. A focusable separator is an
             interactive widget in ARIA (the window splitter pattern), which
             Svelte's static check does not know. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize pinned topics"
          aria-valuemin={1}
          aria-valuemax={Math.max(1, Math.floor(pinnedBounds.max / ROW_HEIGHT_PX))}
          aria-valuenow={Math.max(1, Math.round(pinnedBodyHeight / ROW_HEIGHT_PX))}
          title="Drag to resize. Double-click to reset."
          tabindex="0"
          class={twMerge(
            "group/resize absolute inset-x-0 -bottom-[3px] z-10 flex h-[6px] items-center",
            "cursor-row-resize touch-none select-none outline-none"
          )}
          on:pointerdown={onResizePointerDown}
          on:dblclick={() => setPinnedCap(null, true)}
          on:keydown={onResizeKeydown}
        >
          <!-- Same line, fade and hover delay as ResizableContainer's edge.
               The delay matters more here: the pointer crosses this divider
               every time it moves between the block and the tree, and the
               line should not flash each time. -->
          <div
            class={twMerge(
              "h-[2px] w-full bg-emphasis opacity-0 transition-opacity duration-500",
              "group-hover/resize:opacity-100 group-hover/resize:delay-200",
              "group-focus-visible/resize:opacity-100",
              isResizingPinned && "opacity-100"
            )}
          ></div>
        </div>
      {/if}
    </div>
  {/if}

  <div class="grow min-h-0" bind:this={treeElement}>
    {#if treeData.length > 0}
      <VirtualList items={treeData} let:item itemHeight={ROW_HEIGHT_PX}>
        {@const marginLeftPx = item.levelCount * 18}
        {@const maxWidth = width - marginLeftPx - 8}
        <!-- Pinned to the row height the list is told: left to itself a
             MqttTopicRow lays out at 19.5px in Chromium, and the list's
             offsets, worked out from 19, drift further off with every row. -->
        <div class="flex overflow-hidden" style:height={`${ROW_HEIGHT_PX}px`}>
          <div style:min-width={`${marginLeftPx}px`}></div>
          <div class="grow min-w-0 truncate" style:max-width={`${maxWidth}px`}>
            <!-- ponytail: restore in web mode when broker status has an in-page route. -->
            <MqttTopicRow
              topic={item.expandKey}
              isDecodedProto={item.isDecodedProto}
              isRetained={item.isRetained}
              isPinned={item.isPinned}
              isSelected={selectedTopic === item.topic ||
              revealedTopic === item.topic}
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
    {/if}
  </div>
</div>
