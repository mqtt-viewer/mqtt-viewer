<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import connections, { type Connection } from "@/stores/connections";
  import { addToast } from "@/components/Toast/Toast.svelte";

  export let connection: Connection;
  export let collapseSidebar: () => void;
  // Search opens in a later phase; hidden until wired.
  export let onSearch: (() => void) | null = null;

  $: isConnected = connection.connectionState === "connected";
  $: isBusy =
    connection.connectionState === "connecting" ||
    connection.connectionState === "reconnecting";

  const toggleConnect = async () => {
    try {
      if (isConnected || isBusy) {
        await connections.disconnect(connection.connectionDetails.id);
      } else {
        await connections.connect(connection.connectionDetails.id);
      }
    } catch (e) {
      addToast({
        data: {
          title: isConnected ? "Failed to disconnect" : "Failed to connect",
          description: e as string,
          type: "error",
        },
      });
    }
  };
</script>

<div class="flex items-center justify-end gap-2 px-3 pt-3 pb-2">
  {#if isConnected && connection.latencyMs !== undefined}
    <div class="flex items-center gap-1 mr-1">
      <span class="text-base text-emphasis">{connection.latencyMs} ms</span>
      <span class="size-[5px] rounded-full bg-success"></span>
    </div>
  {:else if isBusy}
    <span class="size-[5px] rounded-full bg-warning mr-1"></span>
  {/if}
  <Tooltip text={isConnected || isBusy ? "Disconnect" : "Connect"}>
    <IconButton onClick={toggleConnect}>
      <Icon type={isConnected ? "connected" : "disconnected"} size={16} />
    </IconButton>
  </Tooltip>
  {#if onSearch}
    <Tooltip text="Search messages">
      <IconButton onClick={onSearch}>
        <Icon type="search" size={16} />
      </IconButton>
    </Tooltip>
  {/if}
  <Tooltip text="Collapse sidebar">
    <IconButton onClick={collapseSidebar}>
      <Icon type="sidebar" size={16} />
    </IconButton>
  </Tooltip>
</div>
