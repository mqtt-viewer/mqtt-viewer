<script lang="ts">
  import type * as models from "bindings/mqtt-viewer/backend/models/models";
  import Icon from "@/components/Icon/Icon.svelte";
  import InlineNameInput from "./InlineNameInput.svelte";
  import ConfirmDeleteDialog from "./ConfirmDeleteDialog.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import type { CollectionScope, CollectionsStore } from "../stores/collections";
  import SavedMessageRow from "./SavedMessageRow.svelte";
  import { writable } from "svelte/store";
  import collectionCollapse from "@/stores/collection-collapse";
  import { draggable } from "../dnd/draggable";
  import {
    dragState,
    isDraggedCollection,
    isFolderDropTarget,
    messageDropIndex,
    type DropTarget,
  } from "../dnd/drag-store";
  import { applyDrop } from "../dnd/handle-drop";

  export let collection: models.Collection;
  export let collectionsStore: CollectionsStore;
  export let scope: CollectionScope = "global";
  export let onOpenMessage: (message: models.CollectionMessage) => void;
  export let onNewMessage: (collectionId: number) => void;

  let isHovered = false;
  $: isExpanded = !$collectionCollapse.has(collection.id);
  let isDeleteOpen = writable(false);
  let isRenaming = false;

  $: messages = collection.messages ?? [];

  $: isDragged = isDraggedCollection($dragState, collection.id);
  $: isDropInto = isFolderDropTarget($dragState, collection.id);
  $: dropIndex = messageDropIndex($dragState, collection.id);

  const lineClass =
    "absolute left-0 right-0 h-[2px] rounded-full bg-primary pointer-events-none";

  $: rowClass = `flex items-center gap-2 grow min-w-0 px-1 -mx-1 py-[2px] rounded text-white-text hover:bg-hovered ${
    isDropInto ? "bg-hovered ring-1 ring-inset ring-primary" : ""
  }`;

  const onDrop = (target: DropTarget) =>
    applyDrop(
      collectionsStore,
      $collectionsStore.collections,
      { kind: "collection", id: collection.id, scope },
      target
    );

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

<div class={`flex flex-col gap-2 ${isDragged ? "opacity-40" : ""}`}>
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
        class={rowClass}
        aria-expanded={isExpanded}
        use:draggable={{
          payload: { kind: "collection", id: collection.id, scope },
          onDrop,
        }}
        on:click={() => collectionCollapse.toggle(collection.id)}
      >
        <span class="w-5 shrink-0 flex items-center justify-center">
          {#if isHovered}
            <Icon type={isExpanded ? "down" : "right"} size={16} />
          {:else}
            <Icon type={isExpanded ? "folderOpen" : "folder"} size={16} />
          {/if}
        </span>
        <span class="text-base font-medium truncate text-left"
          >{collection.name}</span
        >
        <span class="text-sm text-secondary-text shrink-0 pr-6"
          >{messages.length}</span
        >
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
            <DropdownMenuItem onClick={() => onNewMessage(collection.id)}
              >New message</DropdownMenuItem
            >
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
    <div class="flex flex-col gap-1 pl-3" data-dnd-list={collection.id}>
      {#if messages.length === 0}
        <div class="relative">
          {#if dropIndex === 0}
            <span class={lineClass} style="top: -3px"></span>
          {/if}
          <button
            class="flex items-center gap-2 grow px-1 -mx-1 py-[2px] rounded text-white-text hover:bg-hovered"
            on:click={() => onNewMessage(collection.id)}
          >
            <span
              class="w-5 shrink-0 flex items-center justify-center text-primary"
            >
              <Icon type="plusCircle" size={16} />
            </span>
            <span class="text-base">New message</span>
          </button>
        </div>
      {:else}
        {#each messages as message, index (message.id)}
          <div class="relative" data-dnd-row>
            {#if dropIndex === index}
              <span class={lineClass} style="top: -3px"></span>
            {/if}
            {#if dropIndex === messages.length && index === messages.length - 1}
              <span class={lineClass} style="bottom: -3px"></span>
            {/if}
            <SavedMessageRow {message} {collectionsStore} {onOpenMessage} />
          </div>
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
