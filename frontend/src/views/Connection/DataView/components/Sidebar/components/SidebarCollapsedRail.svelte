<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import type { Connection } from "@/stores/connections";

  export let connection: Connection;
  export let expand: () => void;
  export let onNewMessage: () => void;
  export let onSearch: (() => void) | null = null;

  $: isConnected = connection.connectionState === "connected";
</script>

<!-- Sized for the 30px collapsed ResizableContainer width -->
<div class="size-full flex flex-col items-center gap-3 pt-3">
  <Tooltip text="Expand sidebar" placement="right">
    <IconButton onClick={expand}>
      <Icon type="sidebar" size={16} />
    </IconButton>
  </Tooltip>
  {#if isConnected && connection.latencyMs !== undefined}
    <Tooltip text={`Connected — ${connection.latencyMs} ms`} placement="right">
      <span class="block size-[7px] rounded-full bg-success"></span>
    </Tooltip>
  {/if}
  <Tooltip text="New message" placement="right">
    <IconButton onClick={onNewMessage} class="text-primary">
      <Icon type="plusCircle" size={20} />
    </IconButton>
  </Tooltip>
  {#if onSearch}
    <Tooltip text="Search messages" placement="right">
      <IconButton onClick={onSearch}>
        <Icon type="search" size={16} />
      </IconButton>
    </Tooltip>
  {/if}
</div>
