<script lang="ts">
  import type {
    createPublishHistoryStore,
    PublishHistory,
  } from "../../PublishPanel/stores/publish-history";
  import type { CollectionsStore } from "../stores/collections";
  import { groupByRecency } from "../util/group-history";
  import HistoryItem from "./HistoryItem.svelte";

  export let publishHistoryStore: ReturnType<typeof createPublishHistoryStore>;
  export let collectionsStore: CollectionsStore;
  export let onOpenEntry: (entry: PublishHistory[number]) => void;

  // Rendering (and syntax-highlighting) the full 500-entry history at once
  // can stall the UI, so show recent entries and expand on demand.
  const VISIBLE_STEP = 50;
  let visibleCount = VISIBLE_STEP;

  $: hiddenCount = Math.max(
    0,
    $publishHistoryStore.publishHistory.length - visibleCount
  );
  $: groups = groupByRecency(
    $publishHistoryStore.publishHistory.slice(0, visibleCount),
    (entry) => new Date(entry.publishedAt as unknown as string)
  );
</script>

{#if groups.length === 0}
  <div class="flex flex-col gap-2">
    <span class="text-sm font-semibold text-secondary-text">History</span>
    <div class="text-base text-secondary-text px-1">
      Messages you publish will appear here
    </div>
  </div>
{:else}
  {#each groups as group (group.label)}
    <div class="flex flex-col gap-1">
      <span class="text-sm font-semibold text-secondary-text h-5 flex items-end"
        >{group.label}</span
      >
      {#each group.items as entry (entry.id)}
        <HistoryItem
          {entry}
          {collectionsStore}
          {publishHistoryStore}
          onClick={() => onOpenEntry(entry)}
        />
      {/each}
    </div>
  {/each}
  {#if hiddenCount > 0}
    <button
      class="text-base text-secondary-text hover:text-emphasis text-left px-1 pb-2"
      on:click={() => (visibleCount += VISIBLE_STEP)}
    >
      Show {Math.min(hiddenCount, VISIBLE_STEP)} more ({hiddenCount} hidden)
    </button>
  {/if}
{/if}
