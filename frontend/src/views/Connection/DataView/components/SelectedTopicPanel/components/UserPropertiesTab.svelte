<script lang="ts">
  import HeaderRow from "./shared/HeaderRow.svelte";
  import { getSortedObjectDiffs } from "./shared/diff-helpers";

  export let isComparing: boolean;
  export let userProperties: { [key: string]: string } | null;
  export let userPropertiesToCompare: { [key: string]: string } | undefined =
    undefined;

  $: diffedUserProperties = getSortedObjectDiffs({
    objectLeft: userPropertiesToCompare ?? {},
    objectRight: userProperties ?? {},
  });
</script>

<div class="flex flex-col gap-3 max-h-full overflow-auto">
  {#if isComparing && !!userProperties}
    <div class="flex">
      <div class="w-1/3 max-w-1/3">Property</div>
      <div class="w-1/3 max-w-1/3">Previous</div>
      <div class="w-1/3 max-w-1/3">Current</div>
    </div>
    {#each Object.keys(diffedUserProperties) as key}
      <HeaderRow
        rowName={key}
        rowValue={diffedUserProperties[key]?.valueRight ?? ""}
        rowValueDiff={diffedUserProperties[key]?.valueRightDiff}
        rowValueToCompare={diffedUserProperties[key]?.valueLeft ?? ""}
        rowValueToCompareDiff={diffedUserProperties[key]?.valueLeftDiff}
      />
    {/each}
  {:else if !!userProperties}
    <div class="flex">
      <div class="w-1/2 max-w-1/2">Property</div>
      <div class="w-1/2 max-w-1/2">Value</div>
    </div>
    {#each Object.keys(diffedUserProperties) as key}
      <HeaderRow
        rowName={key}
        rowValue={diffedUserProperties[key]?.valueRight ?? ""}
      />
    {/each}
  {:else}
    <div class="text-center text-gray-500">No user properties</div>
  {/if}
</div>
