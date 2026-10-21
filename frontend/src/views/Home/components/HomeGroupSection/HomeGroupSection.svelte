<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import InlineNameInput from "@/views/Connection/DataView/components/Sidebar/components/InlineNameInput.svelte";
  import HomeConnectionList from "../HomeConnectionList/HomeConnectionList.svelte";
  import type { HomeSection } from "../../helpers/sections";
  import type { GroupDrop } from "../../dnd/resolve-group-drop";

  export let section: HomeSection;
  export let search = "";
  export let isSearching = false;
  // Start in inline rename (a freshly created group).
  export let isRenaming = false;
  // Highlight while a dragged card hovers this section.
  export let isDropTarget = false;
  export let onToggle: () => void = () => {};
  export let onRename: (name: string) => void = () => {};
  // Fires on every end of a rename (commit or Escape) so the parent can drop
  // its own rename state.
  export let onRenameEnd: () => void = () => {};
  export let onDelete: () => void = () => {};
  // Card drag callbacks, passed through to the card grid.
  export let onCardDragStart: (connectionId: number) => void = () => {};
  export let onCardHover: (drop: GroupDrop | null) => void = () => {};
  export let onCardDrop: (
    connectionId: number,
    drop: GroupDrop | null
  ) => void = () => {};

  $: group = section.group;
  let renaming = isRenaming;
  $: if (isRenaming) renaming = true;
  $: count = isSearching
    ? `${section.connections.length} of ${section.total}`
    : `${section.total}`;

  const commitRename = (name: string) => {
    endRename();
    if (name && name !== group?.name) onRename(name);
  };

  const endRename = () => {
    renaming = false;
    onRenameEnd();
  };
</script>

<section
  class={`mb-4 rounded ${
    isDropTarget ? "bg-hovered ring-1 ring-inset ring-primary" : ""
  }`}
  data-group-drop={group?.id ?? "ungrouped"}
>
  <div class="group relative flex items-center px-4 py-2 text-secondary-text">
    {#if !group}
      <span class="font-medium">Ungrouped</span>
      <span class="ml-2 text-sm">{count}</span>
    {:else if renaming}
      <div class="max-w-[320px]">
        <InlineNameInput
          name={`rename-group-${group.id}`}
          initialValue={group.name}
          selectAll
          onCommit={commitRename}
          onCancel={endRename}
        />
      </div>
    {:else}
      <button
        class="flex items-center gap-2 min-w-0 rounded hover:text-emphasis"
        aria-expanded={section.open}
        on:click={onToggle}
      >
        <span
          class={`shrink-0 transition-transform ${section.open ? "" : "-rotate-90"}`}
          ><Icon type="down" size={16} /></span
        >
        <span class="font-medium truncate text-white-text">{group.name}</span>
        <span class="text-sm shrink-0">{count}</span>
      </button>
      <div
        class="ml-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
      >
        <DropdownMenu placement="bottom-start">
          <div
            slot="trigger"
            class="flex items-center justify-center p-1 rounded text-secondary-text hover:text-emphasis hover:bg-hovered"
          >
            <Icon type="menuDots" size={16} />
          </div>
          <div class="flex flex-col" slot="menu-content">
            <DropdownMenuItem iconType="edit" onClick={() => (renaming = true)}
              >Rename</DropdownMenuItem
            >
            <DropdownMenuItem
              iconType="delete"
              class="text-error"
              onClick={onDelete}>Delete</DropdownMenuItem
            >
          </div>
        </DropdownMenu>
      </div>
    {/if}
  </div>
  {#if section.open}
    {#if section.connections.length > 0}
      <HomeConnectionList
        connections={section.connections}
        {search}
        onDragStart={onCardDragStart}
        onHover={onCardHover}
        onDrop={onCardDrop}
      />
    {:else}
      <div class="px-4 pb-2 text-sm text-secondary-text">
        {group ? "Drag connections here" : "Drop here to ungroup"}
      </div>
    {/if}
  {/if}
</section>
