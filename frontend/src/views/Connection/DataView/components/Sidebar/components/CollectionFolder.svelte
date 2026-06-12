<script lang="ts">
  import type { models } from "wailsjs/go/models";
  import Icon from "@/components/Icon/Icon.svelte";
  import InlineNameInput from "./InlineNameInput.svelte";
  import ConfirmDeleteDialog from "./ConfirmDeleteDialog.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import type { CollectionsStore } from "../stores/collections";
  import SavedMessageRow from "./SavedMessageRow.svelte";
  import { writable } from "svelte/store";

  export let collection: models.Collection;
  export let collectionsStore: CollectionsStore;
  export let onOpenMessage: (message: models.CollectionMessage) => void;

  let isExpanded = true;
  let isHovered = false;
  let isDeleteOpen = writable(false);
  let isRenaming = false;

  $: messages = collection.messages ?? [];

  const commitRename = async (name: string) => {
    isRenaming = false;
    if (!name || name === collection.name) return;
    try {
      await collectionsStore.renameCollection(collection.id, name);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to rename collection",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const deleteCollection = async () => {
    try {
      await collectionsStore.deleteCollection(collection.id);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to delete collection",
          description: e as string,
          type: "error",
        },
      });
    }
    $isDeleteOpen = false;
  };

  $: deleteDescription =
    messages.length > 0
      ? `Delete "${collection.name}"? The ${messages.length} message${
          messages.length === 1 ? "" : "s"
        } in it will also be deleted.`
      : `Delete "${collection.name}"?`;
</script>

<div class="flex flex-col gap-2">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative flex items-center"
    on:mouseenter={() => (isHovered = true)}
    on:mouseleave={() => (isHovered = false)}
  >
    {#if isRenaming}
      <InlineNameInput
        name={`rename-collection-${collection.id}`}
        initialValue={collection.name}
        onCommit={commitRename}
        onCancel={() => (isRenaming = false)}
      />
    {:else}
      <button
        class="flex items-center gap-2 w-full min-w-0 px-1 py-[2px] rounded text-white-text hover:bg-hovered"
        on:click={() => (isExpanded = !isExpanded)}
      >
        <Icon type={isExpanded ? "folderOpen" : "folder"} size={16} />
        <span class="text-base font-medium truncate grow text-left"
          >{collection.name}</span
        >
        <span class="text-sm text-secondary-text pr-5">{messages.length}</span>
      </button>
      <div
        class={`absolute right-0 top-1/2 -translate-y-1/2 ${
          isHovered ? "" : "invisible"
        }`}
      >
        <DropdownMenu placement="bottom-end">
          <div
            slot="trigger"
            class="flex items-center justify-center p-1 rounded text-secondary-text hover:text-emphasis hover:bg-hovered"
          >
            <Icon type="menuDots" size={16} />
          </div>
          <div class="flex flex-col" slot="menu-content">
            <DropdownMenuItem onClick={() => (isRenaming = true)}
              >Rename</DropdownMenuItem
            >
            <DropdownMenuItem
              class="hover:text-error"
              onClick={() => ($isDeleteOpen = true)}>Delete</DropdownMenuItem
            >
          </div>
        </DropdownMenu>
      </div>
    {/if}
  </div>

  {#if isExpanded}
    <div class="flex flex-col gap-1 pl-3">
      {#if messages.length === 0}
        <div class="text-base text-secondary-text px-1">No messages</div>
      {:else}
        {#each messages as message (message.id)}
          <SavedMessageRow {message} {collectionsStore} {onOpenMessage} />
        {/each}
      {/if}
    </div>
  {/if}
</div>

<ConfirmDeleteDialog
  isOpen={isDeleteOpen}
  title="Delete collection"
  description={deleteDescription}
  onConfirm={deleteCollection}
/>
