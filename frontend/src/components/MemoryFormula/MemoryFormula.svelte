<script lang="ts">
  // The memory estimate shown under the memory budget field, in the settings
  // dialog and in the first-run retention prompt. The figures come from the
  // backend's own limit model, so neither dialog quotes a ceiling the runtime
  // disagrees with, and neither writes the sum down twice.
  import {
    EXAMPLE_CONNECTION_COUNTS,
    MIN_MEMORY_MB,
    formatBytes,
    estimateTotalBytes,
    type MemoryLimitModel,
  } from "@/util/memory-budget";

  // A cleared Svelte number input binds null, so fall back to the floor.
  export let budgetMb: number | null | undefined = MIN_MEMORY_MB;
  // Undefined until the caller has fetched GetMemoryLimitModel; the figures
  // show a placeholder until it lands.
  export let limitModel: MemoryLimitModel | undefined = undefined;

  $: shownBudgetMb = budgetMb ?? MIN_MEMORY_MB;
</script>

<div class="flex flex-col gap-1.5 text-sm text-secondary-text">
  <p>With this budget, expect up to about:</p>
  <ul class="grid grid-cols-[max-content_auto] gap-x-3 font-mono">
    {#each EXAMPLE_CONNECTION_COUNTS as count}
      <li class="contents">
        <span>{count} connection{count === 1 ? "" : "s"}:</span>
        <span
          >{formatBytes(
            estimateTotalBytes(limitModel, shownBudgetMb, count)
          )}</span
        >
      </li>
    {/each}
    <li>etc...</li>
  </ul>
</div>
