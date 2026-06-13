<script lang="ts">
  import connectionStore from "@/stores/connections";
  import DataView from "./DataView/DataView.svelte";
  import { writable } from "svelte/store";
  import { setConnectionIsValidContext } from "./contexts/connection-is-valid";
  import { setConnectionIdContext } from "./contexts/connection-id";
  import tabs from "@/stores/tabs";

  // Still provided for the connection-details form (now hosted in a dialog
  // from the sidebar) which reports its validity through this context.
  let connectionIsValid = writable(false);
  setConnectionIsValidContext(connectionIsValid);

  export let connectionId: number;
  setConnectionIdContext(connectionId);

  $: connection = $connectionStore.connections[connectionId];

  $: isSelected = $tabs.selectedTab === connectionId && !$tabs.isNewTabSelected;
</script>

{#if !connection}
  <div></div>
{:else}
  <div
    class="w-full h-full flex flex-col"
    style:display={isSelected ? undefined : "none"}
  >
    <div class="flex-grow overflow-auto">
      <DataView {connection} />
    </div>
  </div>
{/if}
