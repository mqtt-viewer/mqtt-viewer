<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import Icon from "@/components/Icon/Icon.svelte";
  import ConnectionIdenticon from "@/components/ConnectionIdenticon/ConnectionIdenticon.svelte";
  import type { Connection } from "@/stores/connections";
  import ConnectionStatusCircle from "@/components/ConnectionStatusCircle/ConnectionStatusCircle.svelte";
  export let isSelected = false;
  export let width: number;
  export let connection: Connection;
  export let onClick: () => void;
  export let onDeleteClick: () => void;
  let className = "";
  export { className as class };

  let isHovered = false;
  $: replaceIdenticonOnHover = width < 100;
  $: showConnectionState = connection.connectionState !== "disconnected";
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
  on:click|preventDefault={onClick}
  on:mouseenter={() => (isHovered = true)}
  on:mouseleave={() => (isHovered = false)}
  class={twMerge(
    "h-[38px] pl-3 pr-2 py-1 flex items-center cursor-pointer whitespace-nowrap",
    "select-none truncate border-outline border-r-[1px]",
    isSelected ? "bg-elevation-1" : "bg-black opacity-70",
    isHovered && !isSelected ? "opacity-100" : "",
    className
  )}
  style:width={width + "px"}
  style:max-width={width + "px"}
>
  {#if isHovered && replaceIdenticonOnHover}
    <button
      class="w-4 h-4 ml-1 mr-[6px] p-[1px] rounded hover:bg-hovered"
      on:click|stopPropagation={onDeleteClick}
    >
      <Icon type="close" size={14} />
    </button>
  {:else}
    <div class="rounded-sm w-[22px] h-[22px] min-w-[22px] min-h-[22px] mr-1">
      <ConnectionIdenticon {connection} />
    </div>
  {/if}
  {#if !showConnectionState || !replaceIdenticonOnHover}
    <div class="truncate flex-grow">{connection.connectionDetails.name}</div>
  {/if}
  {#if (!isHovered || replaceIdenticonOnHover) && showConnectionState}
    <ConnectionStatusCircle
      state={connection.connectionState}
      class="ml-2 mr-1"
    />
  {:else if isHovered && !replaceIdenticonOnHover}
    <button
      class="p-[1px] rounded hover:bg-hovered"
      on:click|stopPropagation={onDeleteClick}
    >
      <Icon type="close" size={14} />
    </button>
  {/if}
</div>
