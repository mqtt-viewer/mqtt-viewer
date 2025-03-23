<script lang="ts">
  import type { Connection } from "@/stores/connections";
  import { twMerge } from "tailwind-merge";
  import RecentConnectionsListItem from "./RecentConnectionsListItem.svelte";

  export let connections: Connection[];
  let className = "";
  export { className as class };

  $: sortedConnections = connections.sort((a, b) => {
    const aMs = new Date(a.connectionDetails.lastConnectedAt)?.getTime() ?? 0;
    const bMs = new Date(b.connectionDetails.lastConnectedAt)?.getTime() ?? 0;
    return bMs - aMs;
  });
</script>

<div class={twMerge("w-full flex flex-col gap-3 bg-elevation-1", className)}>
  {#each sortedConnections as connection, index}
    <RecentConnectionsListItem {connection} />
  {/each}
</div>
