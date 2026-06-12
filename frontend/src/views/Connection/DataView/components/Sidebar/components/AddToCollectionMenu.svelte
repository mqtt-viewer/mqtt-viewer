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

  let query = "";

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
  };
</script>

<DropdownMenu placement="bottom-end">
  <slot name="trigger" slot="trigger" />
  <div class="flex flex-col min-w-[220px]" slot="menu-content">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="bg-transparent outline-none border-b border-divider px-2 pb-2 pt-1 mb-1 text-base text-white-text placeholder:text-secondary-text"
      autofocus
      {placeholder}
      bind:value={query}
      on:keydown|stopPropagation={() => {}}
    />
    {#if connectionMatches.length > 0}
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
    {#if globalMatches.length > 0}
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
    {#if matches.length === 0 && query.trim()}
      <div class="px-2 py-1 text-base text-secondary-text">
        Collection not found
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
    <slot name="extra-items" />
  </div>
</DropdownMenu>
