<script lang="ts">
  import type * as models from "bindings/mqtt-viewer/backend/models/models";
  import Icon from "@/components/Icon/Icon.svelte";
  import InlineNameInput from "./InlineNameInput.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import type { CollectionsStore } from "../stores/collections";
  import { draggable } from "../dnd/draggable";
  import { dragState, isDraggedMessage, type DropTarget } from "../dnd/drag-store";
  import { applyDrop } from "../dnd/handle-drop";

  export let message: models.CollectionMessage;
  export let collectionsStore: CollectionsStore;
  export let onOpenMessage: (message: models.CollectionMessage) => void;

  let isHovered = false;
  let isRenaming = false;

  $: isDragged = isDraggedMessage($dragState, message.id);

  const onDrop = (target: DropTarget) =>
    applyDrop(
      collectionsStore,
      $collectionsStore.collections,
      { kind: "message", id: message.id, collectionId: message.collectionId },
      target
    );

  $: otherCollections = $collectionsStore.collections.filter(
    (c) => c.id !== message.collectionId
  );

  const commitRename = async (name: string) => {
    isRenaming = false;
    if (!name || name === message.name) return;
    try {
      await collectionsStore.renameMessage(message.id, name);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to rename message",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const run = async (action: () => Promise<unknown>, errorTitle: string) => {
    try {
      await action();
    } catch (e) {
      addToast({
        data: { title: errorTitle, description: e as string, type: "error" },
      });
    }
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={`relative flex items-center ${isDragged ? "opacity-40" : ""}`}
  on:mouseenter={() => (isHovered = true)}
  on:mouseleave={() => (isHovered = false)}
>
  {#if isRenaming}
    <InlineNameInput
      name={`rename-message-${message.id}`}
      initialValue={message.name}
      onCommit={commitRename}
      onCancel={() => (isRenaming = false)}
    />
  {:else}
    <button
      class="flex items-center gap-2 grow min-w-0 px-1 -mx-1 py-[2px] rounded text-white-text hover:bg-hovered"
      use:draggable={{
        payload: {
          kind: "message",
          id: message.id,
          collectionId: message.collectionId,
        },
        onDrop,
      }}
      on:click={() => onOpenMessage(message)}
    >
      <Icon type="message" size={16} />
      <span class="text-base font-medium truncate grow text-left pr-6"
        >{message.name}</span
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
          <DropdownMenuItem
            iconType="copy"
            onClick={() =>
              run(
                () => collectionsStore.duplicateMessage(message.id),
                "Failed to duplicate message"
              )}>Duplicate</DropdownMenuItem
          >
          <DropdownMenuItem
            iconType="edit"
            onClick={() => (isRenaming = true)}>Rename</DropdownMenuItem
          >
          {#if otherCollections.length > 0}
            <div class="px-2 pt-2 pb-1 text-sm text-secondary-text">
              Move to...
            </div>
            {#each otherCollections as collection (collection.id)}
              <DropdownMenuItem
                iconType="folder"
                onClick={() =>
                  run(
                    () =>
                      collectionsStore.moveMessage(message.id, collection.id),
                    "Failed to move message"
                  )}
              >
                <span class="truncate">{collection.name}</span>
              </DropdownMenuItem>
            {/each}
          {/if}
          <DropdownMenuItem
            iconType="delete"
            class="text-error"
            onClick={() =>
              run(
                () => collectionsStore.deleteMessage(message.id),
                "Failed to delete message"
              )}>Delete</DropdownMenuItem
          >
        </div>
      </DropdownMenu>
    </div>
  {/if}
</div>
