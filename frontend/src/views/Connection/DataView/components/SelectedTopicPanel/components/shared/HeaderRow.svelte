<script lang="ts">
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import type { Diff } from "./diff-helpers";
  import HeaderRowItem from "./HeaderRowItem.svelte";

  export let rowName: string;
  export let rowValue: string;
  export let rowValueDiff: Diff | undefined = undefined;
  export let rowValueToCompare: string | undefined = undefined;
  export let rowValueToCompareDiff: Diff | undefined = undefined;

  $: isComparing = rowValueToCompare !== undefined;
</script>

<div class="flex gap-2 min-w-0">
  <div
    class={`${isComparing ? "w-1/3 max-w-1/3" : "w-1/2 max-w-1/2"} truncate`}
  >
    <Tooltip
      class="truncate w-fit max-w-full text-secondary-text"
      text={rowName}>{rowName}</Tooltip
    >
  </div>
  {#if isComparing}
    <div class={`w-1/3 max-w-1/3`}>
      <Tooltip class="truncate w-fit max-w-full" text={rowValueToCompare}
        ><HeaderRowItem
          value={rowValueToCompare}
          valueDiff={rowValueToCompareDiff}
        /></Tooltip
      >
    </div>
  {/if}
  <div
    class={`${isComparing ? "w-1/3 max-w-1/3" : "w-1/2 max-w-1/2"} truncate`}
  >
    <Tooltip class="truncate w-fit max-w-full" text={rowValue}
      ><HeaderRowItem value={rowValue} valueDiff={rowValueDiff} /></Tooltip
    >
  </div>
</div>
