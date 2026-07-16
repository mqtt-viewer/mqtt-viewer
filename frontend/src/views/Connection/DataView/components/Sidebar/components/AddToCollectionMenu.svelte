<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import type { CollectionScope, CollectionsStore } from "../stores/collections";
  import { filterByScope } from "../stores/collections";

  export let collectionsStore: CollectionsStore;
  // Collection currently holding the message (checked in the list), if any.
  export let currentCollectionId: number | null = null;
  export let placeholder = "Add message to...";
  export let onSelect: (collectionId: number) => void;
  // Creates the collection, then selects it.
  export let onCreate: (
    name: string,
    scope: CollectionScope
  ) => Promise<void>;

  let menu: DropdownMenu;
  let inputEl: HTMLInputElement;
  let query = "";
  // Explicit create mode: the search input doubles as the new collection's
  // name field and the matches list is hidden.
  let isCreating = false;

  // The menu body remounts on every open; clear leftovers from the last one.
  const resetOnOpen = (_node: HTMLElement) => {
    query = "";
    isCreating = false;
  };

  $: collections = $collectionsStore.collections;
  $: matches = query.trim()
    ? collections.filter((c) =>
        c.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : collections;
  $: globalMatches = filterByScope(matches, "global");
  $: connectionMatches = filterByScope(matches, "connection");
  // per-scope: a global "Sensors" must not block creating a connection-scoped one
  $: connectionExactMatch = filterByScope(collections, "connection").some(
    (c) => c.name.toLowerCase() === query.trim().toLowerCase()
  );
  $: globalExactMatch = filterByScope(collections, "global").some(
    (c) => c.name.toLowerCase() === query.trim().toLowerCase()
  );

  const create = async (scope: CollectionScope) => {
    const name = query.trim();
    if (!name) return;
    await onCreate(name, scope);
    query = "";
    isCreating = false;
  };

  const startCreating = () => {
    isCreating = true;
    query = "";
    inputEl.focus();
  };

  const onKeydown = async (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (isCreating) {
        // Back out of create mode before closing the whole menu.
        isCreating = false;
        query = "";
      } else {
        query = "";
        menu.close();
      }
      return;
    }
    if (event.key !== "Enter") return;
    const name = query.trim();
    if (!name) return;
    // Enter picks the connection-scoped collection with this name, or
    // creates one; the global rows stay click-only.
    const existing = filterByScope(collections, "connection").find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      onSelect(existing.id);
      query = "";
    } else {
      await create("connection");
    }
    menu.close();
  };
</script>

<DropdownMenu bind:this={menu} placement="bottom-end">
  <slot name="trigger" slot="trigger" />
  <div class="flex flex-col min-w-[220px]" slot="menu-content" use:resetOnOpen>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={inputEl}
      class="bg-transparent outline-none border-b border-divider px-2 pb-2 pt-1 mb-1 text-base text-white-text placeholder:text-secondary-text"
      autofocus
      placeholder={isCreating ? "New collection name..." : placeholder}
      bind:value={query}
      on:keydown|stopPropagation={onKeydown}
    />
    {#if !isCreating && connectionMatches.length > 0}
      <div class="px-2 pt-1 pb-1 text-sm text-secondary-text">Connection</div>
      {#each connectionMatches as collection (collection.id)}
        <DropdownMenuItem onClick={() => onSelect(collection.id)}>
          <div class="flex items-center gap-2 w-full">
            <Icon type="folder" size={14} />
            <span class="truncate grow">{collection.name}</span>
            {#if collection.id === currentCollectionId}
              <Icon type="tick" size={14} />
            {/if}
          </div>
        </DropdownMenuItem>
      {/each}
    {/if}
    {#if !isCreating && globalMatches.length > 0}
      <div class="px-2 pt-1 pb-1 text-sm text-secondary-text">Global</div>
      {#each globalMatches as collection (collection.id)}
        <DropdownMenuItem onClick={() => onSelect(collection.id)}>
          <div class="flex items-center gap-2 w-full">
            <Icon type="folder" size={14} />
            <span class="truncate grow">{collection.name}</span>
            {#if collection.id === currentCollectionId}
              <Icon type="tick" size={14} />
            {/if}
          </div>
        </DropdownMenuItem>
      {/each}
    {/if}
    {#if !isCreating && matches.length === 0 && query.trim()}
      <div class="px-2 py-1 text-base text-secondary-text">
        Collection not found
      </div>
    {/if}
    {#if isCreating && !query.trim()}
      <div class="px-2 py-1 text-base text-secondary-text">
        Type a name for the new collection
      </div>
    {/if}
    {#if query.trim() && !connectionExactMatch}
      <DropdownMenuItem onClick={() => create("connection")}>
        <div class="flex items-center gap-2">
          <Icon type="plus" size={14} />
          <span class="truncate">Create “{query.trim()}”</span>
        </div>
      </DropdownMenuItem>
    {/if}
    {#if query.trim() && !globalExactMatch}
      <DropdownMenuItem onClick={() => create("global")}>
        <div class="flex items-center gap-2">
          <Icon type="plus" size={14} />
          <span class="truncate">Create “{query.trim()}” (global)</span>
        </div>
      </DropdownMenuItem>
    {/if}
    {#if !isCreating && !query.trim()}
      {#if collections.length > 0}
        <div class="border-t border-divider my-1"></div>
      {/if}
      <!-- Plain button (not a melt menu item) so clicking keeps the menu open. -->
      <button
        type="button"
        class="flex items-center gap-2 text-left rounded py-[6px] px-2 text-white-text hover:bg-elevation-2-hover hover:text-emphasis"
        on:click={startCreating}
      >
        <Icon type="plus" size={14} />
        <span class="truncate">New collection...</span>
      </button>
    {/if}
    <slot name="extra-items" />
  </div>
</DropdownMenu>
