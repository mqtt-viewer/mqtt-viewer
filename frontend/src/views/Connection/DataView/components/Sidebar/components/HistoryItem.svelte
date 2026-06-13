<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import { highlightJson } from "@/components/CodeEditor/highlighter";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import type {
    createPublishHistoryStore,
    PublishHistory,
  } from "../../PublishPanel/stores/publish-history";
  import type { CollectionScope, CollectionsStore } from "../stores/collections";
  import AddToCollectionMenu from "./AddToCollectionMenu.svelte";

  export let entry: PublishHistory[number];
  export let collectionsStore: CollectionsStore;
  export let publishHistoryStore: ReturnType<typeof createPublishHistoryStore>;
  export let onClick: () => void;

  let isHovered = false;

  $: syntaxHighlightedPayload = entry.payload
    ? highlightJson(entry.payload)
    : "";
  $: encodingTag =
    entry.encoding === "base64"
      ? "Base64"
      : entry.encoding === "hex"
        ? "Hex"
        : null;

  // Saves this history entry into a collection, named after its topic.
  const saveToCollection = async (collectionId: number) => {
    try {
      await collectionsStore.saveMessage({
        collectionId,
        name: entry.topic || "Untitled message",
        topic: entry.topic,
        payload: entry.payload,
        qos: entry.qos,
        retain: entry.retain,
        encoding: entry.encoding,
        format: entry.format,
        userProperties: entry.userProperties,
        headerContentType: entry.headerContentType,
        headerResponseTopic: entry.headerResponseTopic,
        headerCorrelationData: entry.headerCorrelationData,
        headerPayloadFormatIndicator: entry.headerPayloadFormatIndicator,
        headerMessageExpiryInterval: entry.headerMessageExpiryInterval,
        headerTopicAlias: entry.headerTopicAlias,
        headerSubscriptionIdentifier: entry.headerSubscriptionIdentifier,
      });
      addToast({
        data: {
          title: "Message saved to collection",
          description: entry.topic,
          type: "success",
        },
      });
    } catch (e) {
      addToast({
        data: {
          title: "Failed to save message",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  const createAndSave = async (name: string, scope: CollectionScope) => {
    try {
      const created = await collectionsStore.createCollection(name, scope);
      await saveToCollection(created.id);
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

  const deleteEntry = async () => {
    try {
      await publishHistoryStore.deletePublishEntry(entry.id);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to delete history entry",
          description: e as string,
          type: "error",
        },
      });
    }
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative"
  on:mouseenter={() => (isHovered = true)}
  on:mouseleave={() => (isHovered = false)}
>
  <button
    class="w-full text-left rounded px-1 py-1 hover:bg-hovered text-white-text space-y-1"
    on:click={onClick}
  >
    <div class="w-full flex gap-2 items-center">
      {#if encodingTag}
        <div
          class="font-mono text-sm leading-1 pt-[1px] border border-chip-border px-1"
        >
          {encodingTag}
        </div>
      {/if}
      {#if entry.retain}
        <div
          class="text-secondary font-mono text-sm leading-1 pt-[1px] border border-chip-border px-1"
        >
          Retain
        </div>
      {/if}
      <div class="truncate grow min-w-0 pr-5">{entry.topic}</div>
    </div>
    <div class="font-mono truncate text-secondary-text">
      {@html syntaxHighlightedPayload}
    </div>
  </button>
  <div
    class={`absolute right-0 top-1 ${isHovered ? "" : "invisible"}`}
  >
    <AddToCollectionMenu
      {collectionsStore}
      onSelect={saveToCollection}
      onCreate={createAndSave}
    >
      <div
        slot="trigger"
        class="flex items-center justify-center p-1 rounded bg-elevation-1 text-secondary-text hover:text-emphasis hover:bg-hovered"
      >
        <Icon type="menuDots" size={16} />
      </div>
      <svelte:fragment slot="extra-items">
        <div class="border-t border-divider my-1"></div>
        <DropdownMenuItem class="hover:text-error" onClick={deleteEntry}
          >Delete</DropdownMenuItem
        >
      </svelte:fragment>
    </AddToCollectionMenu>
  </div>
</div>
