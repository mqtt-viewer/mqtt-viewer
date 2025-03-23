<script lang="ts">
  import IconButton from "@/components/Button/IconButton.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import { untypedColors } from "@/util/resolvedTailwindConfig";
  import { createPopover, melt } from "@melt-ui/svelte";
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import { getConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import { twMerge } from "tailwind-merge";
  import { createFilterHistoryStore } from "./stores/filter-history";
  //@ts-ignore
  import VirtualList from "@sveltejs/svelte-virtual-list";
  import { type ActionButton } from "@/components/InputFields/interfaces";

  export let searchText = "";

  let connectionId = getConnectionIdContext();
  let filterHistoryStore = createFilterHistoryStore(connectionId);

  $: filteredHistory = $filterHistoryStore.filterHistory.filter(
    (item) => searchText == "" || item.text.includes(searchText)
  );

  const fieldColor = untypedColors["outline"]["DEFAULT"];
  const fieldHoverColor = untypedColors["hovered"]["DEFAULT"];

  const inputElName = "search-bar-mqtt-data" + connectionId;
  let inputEl: HTMLInputElement;
  let isOpen = writable(false);

  const { elements } = createPopover({
    onOpenChange: ({ curr, next }) => {
      return curr;
    },
    open: isOpen,
    closeOnOutsideClick: true,
    disableFocusTrap: true,
    positioning: {
      placement: "bottom-end",
      sameWidth: true,
      offset: {
        mainAxis: -2,
        crossAxis: -20,
      },
    },
  });

  const { trigger, content } = elements;

  $: hasHistory = $filterHistoryStore.filterHistory.length > 0;
  $: hasHistory,
    (() => {
      if ($isOpen && !hasHistory) {
        isOpen.set(false);
      }
    })();

  let inputWidth = 0;

  onMount(() => {
    inputEl = document.getElementById(inputElName) as HTMLInputElement;
  });

  // Super hacky to precent the popover from capturing the space
  // key press when the input is focused
  let captureSpaceAbortSignal = new AbortController();
  const captureSpacePress = () => {
    console.log("Capturing space press");
    document.body.addEventListener(
      "keyup",
      function (e) {
        if (e.code == "Space") {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
          const [start, end] = [inputEl.selectionStart, inputEl.selectionEnd];
          if (start !== null && end !== null) {
            inputEl.setRangeText(" ", start!, end!, "end");
          } else {
            inputEl.value += " ";
          }
        }
      },
      {
        signal: captureSpaceAbortSignal.signal,
      }
    );
  };

  const stopCapturingSpacePress = () => {
    console.log("Stopping capturing space press");
    captureSpaceAbortSignal.abort();
    captureSpaceAbortSignal = new AbortController();
  };

  $: filterListHeight =
    (filteredHistory.length > 5 ? 5 : filteredHistory.length) * 25 + 8;

  $: getActionButtons = () => {
    const actionItems: ActionButton[] = [];
    if (searchText !== "") {
      actionItems.push({
        icon: "close",
        tooltipText: "Clear search",
        onClick: (e: MouseEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          searchText = "";
        },
      });
    }
    if (hasHistory) {
      actionItems.push({
        icon: "history",
        tooltipText: "View filter history",
        onClick: () => {
          if ($isOpen) {
            isOpen.set(false);
          } else {
            isOpen.set(true);
            inputEl?.focus();
          }
        },
      });
    }
    return actionItems;
  };

  $: actionButtons = getActionButtons();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div use:melt={$trigger} class="relative flex-grow max-w-[400px]">
  <BaseInput
    id={inputElName}
    icon="search"
    name={inputElName}
    placeholder="Filter by topic, payload or pattern"
    bgColor={fieldColor}
    bgHoverColor={fieldHoverColor}
    inputClass={hasHistory ? "pr-7" : undefined}
    bind:inputEl
    bind:value={searchText}
    bind:width={inputWidth}
    onFocus={captureSpacePress}
    onBlur={async () => {
      stopCapturingSpacePress();
      const currentText = searchText;
      if (currentText !== "") {
        filterHistoryStore.saveFilterHistoryEntry(currentText);
      }
      if ($isOpen) {
        setTimeout(() => {
          isOpen.set(false);
        }, 110);
      }
    }}
    {actionButtons}
  />
  {#if hasHistory}
    <div
      style:height={`${filterListHeight}px`}
      class={`bg-outline flex flex-col
    z-30 p-1 min-w-[100px] shadow
      rounded focus:!ring-0
      ${filteredHistory.length > 0 ? "block" : "hidden"}
    `}
      use:melt={$content}
    >
      <VirtualList items={filteredHistory} let:item>
        {@const historyItem = item}
        <div class="relative w-full">
          <button
            class={twMerge(
              "text-left cursor-pointer w-full rounded py-[3px] px-2",
              "hover:bg-elevation-2-hover text-white-text hover:text-white"
            )}
            on:click={() => {
              console.log("clicked", historyItem);
              searchText = historyItem.text;
              isOpen.set(false);
            }}
          >
            <div class="flex gap-2 items-center">
              <Icon type="history" size={16} />
              <div class="truncate">
                <span class="text-secondary-text">'</span
                >{historyItem.text}<span class="text-secondary-text">'</span>
              </div>
            </div>
          </button>
          <IconButton
            preventFocus
            onClick={(e) => {
              e?.preventDefault();
              e?.stopPropagation();
              filterHistoryStore.deleteFilterHistoryEntry(historyItem.text);
            }}
            class="absolute top-1/2 p-1.5 -translate-y-1/2 right-[2.5px]"
          >
            <Icon type="close" size={12} />
          </IconButton>
        </div>
      </VirtualList>
      <!-- {#each filteredHistory as h} -->

      <!-- {/each} -->
    </div>
  {/if}
</div>
