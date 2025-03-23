<script lang="ts">
  import connectionStore from "@/stores/connections";
  import ConnectView from "./ConnectionDetailsView/ConnectionDetailsView.svelte";
  import DataView from "./DataView/DataView.svelte";
  import ConnectionHeaderBar from "./components/ConnectionHeaderBar.svelte";
  import { writable } from "svelte/store";
  import { setConnectionIsValidContext } from "./contexts/connection-is-valid";
  import { setConnectionIdContext } from "./contexts/connection-id";
  import tabs from "@/stores/tabs";

  let connectionIsValid = writable(false);
  setConnectionIsValidContext(connectionIsValid);

  export let connectionId: number;
  setConnectionIdContext(connectionId);

  $: connection = $connectionStore.connections[connectionId];

  $: isSelected = $tabs.selectedTab === connectionId && !$tabs.isNewTabSelected;

  $: showDataView = connection?.showDataPageWhileDisconnected;
</script>

{#if !connection}
  <div></div>
{:else}
  <div
    class="w-full h-full flex flex-col"
    style:display={isSelected ? undefined : "none"}
  >
    <ConnectionHeaderBar {connection} connectionIsValid={$connectionIsValid} />
    <div class="flex-grow overflow-auto">
      <div class={`size-full ${showDataView ? "hidden" : ""}`}>
        <ConnectView {connection} />
      </div>
      <div class={`size-full ${showDataView ? "" : "hidden"}`}>
        <DataView {connection} />
      </div>
    </div>
  </div>
{/if}
