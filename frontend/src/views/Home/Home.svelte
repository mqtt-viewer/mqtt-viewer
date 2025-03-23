<script lang="ts">
  import moment from "moment";
  import HomeConnectionList from "./components/HomeConnectionList/HomeConnectionList.svelte";
  import HomeHeaderBar from "./components/HomeHeaderBar.svelte";

  import connectionsStore from "@/stores/connections";
  import Button from "@/components/Button/Button.svelte";

  $: connections = Object.keys($connectionsStore.connections ?? {}).map(
    (key) => $connectionsStore.connections[parseInt(key)]
  );

  const isConnectedRecently = (lastConnectedAt: Date | null) => {
    if (!lastConnectedAt) {
      return false;
    }
    const daysAgo = moment().diff(lastConnectedAt, "days");
    return daysAgo < 7;
  };

  $: connectionsByLastConnectedAt = connections.sort((a, b) => {
    if (!a.connectionDetails.lastConnectedAt) {
      return 1;
    }
    if (!b.connectionDetails.lastConnectedAt) {
      return -1;
    }
    if (a.connectionState == "connected" && b.connectionState != "connected") {
      return -1;
    }
    if (a.connectionState != "connected" && b.connectionState == "connected") {
      return 1;
    }
    return (
      b.connectionDetails.lastConnectedAt.getTime() -
      a.connectionDetails.lastConnectedAt.getTime()
    );
  });
</script>

<div class="h-full w-full flex flex-col">
  <HomeHeaderBar />
  {#if connectionsByLastConnectedAt.length === 0}
    <div
      class="bg-elevation-1 flex-grow flex flex-col items-center justify-center"
    >
      <div class="mb-4 text-secondary-text">Nothing to see here... yet</div>
      <div>
        <Button
          variant="secondary"
          iconType="plus"
          iconSize={16}
          on:click={() => connectionsStore.addConnection()}
          >Add Connection</Button
        >
      </div>
    </div>
  {:else}
    <div class="flex-grow h-0 overflow-auto scrollbar bg-elevation-1 pb-4">
      <div class="px-4 py-4 text-secondary-text">All connections</div>
      <HomeConnectionList connections={connectionsByLastConnectedAt} />
    </div>
  {/if}
</div>
