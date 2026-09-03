<script lang="ts">
  import type * as models from "bindings/mqtt-viewer/backend/models/models";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import InlineNameInput from "./InlineNameInput.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import {
    filterByScope,
    type CollectionScope,
    type CollectionsStore,
  } from "../stores/collections";
  import CollectionFolder from "./CollectionFolder.svelte";
  import { collectionDropIndex, dragState } from "../dnd/drag-store";

  export let scope: CollectionScope;
  export let collectionsStore: CollectionsStore;
  export let onOpenMessage: (message: models.CollectionMessage) => void;
  export let onNewMessage: (collectionId: number) => void;

  $: collections = filterByScope($collectionsStore.collections, scope);
  $: title = scope === "global" ? "Global Collections" : "Connection Collections";

  let isCreating = false;

  $: dropIndex = collectionDropIndex($dragState, scope);

  const lineClass =
    "absolute left-0 right-0 h-[2px] rounded-full bg-primary pointer-events-none";

  const commitCreate = async (name: string) => {
    isCreating = false;
    if (!name) return;
    try {
      await collectionsStore.createCollection(name, scope);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to create collection",
          description: e as string,
          type: "error",
        },
      });
    }
  };
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center justify-between h-5">
    <span class="text-sm font-semibold text-secondary-text">{title}</span>
    <Tooltip text={`New ${scope} collection`}>
      <IconButton onClick={() => (isCreating = true)}>
        <Icon type="plus" size={16} />
      </IconButton>
    </Tooltip>
  </div>

  {#if isCreating}
    <InlineNameInput
      name={`new-${scope}-collection`}
      placeholder="Type to add a new collection"
      onCommit={commitCreate}
      onCancel={() => (isCreating = false)}
    />
  {/if}

  {#if collections.length === 0 && !isCreating}
    <div class="text-base text-secondary-text">
      No collections yet
    </div>
  {:else}
    <div class="flex flex-col gap-2" data-dnd-section={scope}>
      {#each collections as collection, index (collection.id)}
        <div class="relative" data-dnd-folder={collection.id}>
          {#if dropIndex === index}
            <span class={lineClass} style="top: -5px"></span>
          {/if}
          {#if dropIndex === collections.length && index === collections.length - 1}
            <span class={lineClass} style="bottom: -5px"></span>
          {/if}
          <CollectionFolder
            {collection}
            {collectionsStore}
            {scope}
            {onOpenMessage}
            {onNewMessage}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>
