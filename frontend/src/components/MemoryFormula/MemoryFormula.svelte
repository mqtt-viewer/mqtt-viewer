<script lang="ts">
  // The memory estimate shown under the memory budget field, in the settings
  // dialog and in the first-run retention prompt. The app baseline comes from
  // the shared constant, so the figure is never written down twice.
  import {
    BASE_APP_BYTES,
    MIN_MEMORY_MB,
    formatBytes,
  } from "@/util/memory-budget";

  // A cleared Svelte number input binds null, so fall back to the floor.
  export let budgetMb: number | null | undefined = MIN_MEMORY_MB;

  const baseAppLabel = formatBytes(BASE_APP_BYTES);
  $: shownBudgetMb = budgetMb ?? MIN_MEMORY_MB;
</script>

<p class="font-mono text-sm text-secondary-text">
  Total = active connections × {shownBudgetMb} MB + {baseAppLabel} app
</p>
