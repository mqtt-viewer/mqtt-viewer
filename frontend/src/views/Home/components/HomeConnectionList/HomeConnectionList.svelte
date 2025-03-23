<script lang="ts">
  import type { Connection } from "@/stores/connections";
  import HomeConnectionListItem from "./HomeConnectionListItem.svelte";

  const MAX_ITEM_WIDTH = 250;

  export let connections: Connection[] = [];

  let maxGridWidth = 99999;

  $: connections,
    (() => {
      maxGridWidth = connections.length * MAX_ITEM_WIDTH;
    })();
</script>

<div class="w-full max-w-full max-h-full flex flex-col px-4">
  <div
    class="grid gap-6 grid-cols-[repeat(auto-fit,_minmax(180px,_1fr))]"
    style:max-width={maxGridWidth + "px"}
  >
    {#each connections as connection}
      <HomeConnectionListItem {connection} />
    {/each}
  </div>
</div>
