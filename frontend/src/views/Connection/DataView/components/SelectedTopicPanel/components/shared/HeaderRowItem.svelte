<script lang="ts">
  import type { Diff } from "./diff-helpers";

  export let value: string | undefined = undefined;
  export let valueDiff: Diff | undefined = undefined;
</script>

<div class="flex gap-1">
  {#if !!valueDiff}
    <div class="w-[8px]">
      <span class={valueDiff === "-" ? "text-red-600" : "text-green-600"}
        >{valueDiff}</span
      >
    </div>
    <span
      class={`grow min-w-0 truncate bg-opacity-30 ${valueDiff === "-" ? "bg-red-600" : "bg-green-600"}`}
    >
      {value}
    </span>
  {:else}
    <span class="grow min-w-0 trunacate">{value}</span>
  {/if}
</div>
