<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import Icon from "@/components/Icon/Icon.svelte";

  export let value = "";
  export let descriptorNames: string[] = [];
  export let disabled = false;
  export let onPick: (name: string) => void = () => {};

  // Filter text is local to each picker instance, so the parent no longer
  // has to keep a per-row search map keyed by rule id.
  let search = "";

  $: filteredTypes = (() => {
    const query = search.trim().toLowerCase();
    if (!query) return descriptorNames;
    return descriptorNames.filter((name) => name.toLowerCase().includes(query));
  })();
</script>

<DropdownMenu {disabled} placement="bottom-end">
  <div
    slot="trigger"
    class={twMerge(
      "h-[30px] w-[180px] flex items-center justify-between gap-1 rounded border border-outline px-2 text-base bg-elevation-0 transition-colors",
      disabled ? "opacity-60" : "cursor-pointer hover:border-hovered",
      value ? "text-white-text" : "text-secondary-text"
    )}
  >
    <span class="truncate min-w-0" style:direction="rtl"
      ><bdi>{value || "Choose a type"}</bdi></span
    >
    <Icon type="down" size={12} />
  </div>
  <div class="flex flex-col min-w-[220px]" slot="menu-content">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="bg-transparent outline-none border-b border-divider px-2 pb-2 pt-1 mb-1 text-base text-white-text placeholder:text-secondary-text"
      autofocus
      placeholder="Filter types..."
      bind:value={search}
      on:keydown|stopPropagation={() => {}}
    />
    <div class="flex flex-col max-h-[320px] overflow-y-auto">
      {#each filteredTypes as name (name)}
        <DropdownMenuItem
          onClick={() => {
            onPick(name);
            search = "";
          }}
        >
          <div class="flex items-center gap-2 w-full">
            <span class="truncate grow">{name}</span>
            {#if name === value}
              <Icon type="tick" size={14} />
            {/if}
          </div>
        </DropdownMenuItem>
      {/each}
      {#if descriptorNames.length === 0}
        <div class="px-2 py-1 text-base text-secondary-text">No types loaded</div>
      {:else if filteredTypes.length === 0}
        <div class="px-2 py-1 text-base text-secondary-text">
          No matching types
        </div>
      {/if}
    </div>
  </div>
</DropdownMenu>
