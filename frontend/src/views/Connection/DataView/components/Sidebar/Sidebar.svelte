<script lang="ts">
  import type { models } from "wailsjs/go/models";
  import type { Connection } from "@/stores/connections";
  import { getConnectionIdContext } from "@/views/Connection/contexts/connection-id";
  import { createPublishStore } from "../PublishPanel/stores/publish-details";
  import {
    createPublishHistoryStore,
    type PublishHistory,
  } from "../PublishPanel/stores/publish-history";
  import { createCollectionsStore } from "./stores/collections";
  import SidebarTopBar from "./components/SidebarTopBar.svelte";
  import SidebarCollapsedRail from "./components/SidebarCollapsedRail.svelte";
  import ConnectionRow from "./components/ConnectionRow.svelte";
  import NewMessageRow from "./components/NewMessageRow.svelte";
  import CollectionsSection from "./components/CollectionsSection.svelte";
  import HistorySection from "./components/HistorySection.svelte";
  import PublishView from "./components/PublishView.svelte";
  import SearchMessagesModal from "./components/SearchMessagesModal.svelte";
  import { twMerge } from "tailwind-merge";
  import { writable } from "svelte/store";

  export let connection: Connection;
  export let isOpen: boolean;
  export let isPublishDisabled: boolean;
  export let open: () => void;
  export let close: () => void;
  export let getTopicMatchesSubscription: (
    topic: string
  ) => Promise<models.Subscription | null>;

  const connectionId = getConnectionIdContext();
  const publishStore = createPublishStore(connectionId);
  const publishHistoryStore = createPublishHistoryStore(
    connectionId,
    publishStore
  );
  const collectionsStore = createCollectionsStore(connectionId);

  let page: "library" | "publish" = "library";
  let isSearchOpen = writable(false);
  const openSearch = () => ($isSearchOpen = true);

  const openNewMessage = () => {
    publishStore.setSource(null);
    page = "publish";
  };

  const openSavedMessage = (message: models.CollectionMessage) => {
    publishStore.setSource(message);
    page = "publish";
  };

  const openHistoryEntry = (entry: PublishHistory[number]) => {
    publishStore.setSource(null);
    publishHistoryStore.setPublishDetailsFromHistoryEntry(
      entry as models.PublishHistory
    );
    page = "publish";
  };

  const backToLibrary = () => {
    page = "library";
  };

  const expandIntoNewMessage = () => {
    open();
    openNewMessage();
  };
</script>

<div
  class={twMerge(
    "size-full max-h-full",
    "bg-elevation-1 border-r-[1px] border-r-outline",
    "relative overflow-hidden flex flex-col"
  )}
>
  {#if !isOpen}
    <SidebarCollapsedRail
      {connection}
      expand={open}
      onNewMessage={expandIntoNewMessage}
      onSearch={openSearch}
    />
  {:else if page === "publish"}
    <PublishView
      {connection}
      {isPublishDisabled}
      {getTopicMatchesSubscription}
      {publishStore}
      {publishHistoryStore}
      {collectionsStore}
      onBack={backToLibrary}
    />
  {:else}
    <div class="size-full flex flex-col min-h-0">
      <SidebarTopBar {connection} collapseSidebar={close} onSearch={openSearch} />
      <ConnectionRow {connection} />
      <NewMessageRow onClick={openNewMessage} />
      <div class="grow min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-4">
        <CollectionsSection
          scope="global"
          {collectionsStore}
          onOpenMessage={openSavedMessage}
        />
        <CollectionsSection
          scope="connection"
          {collectionsStore}
          onOpenMessage={openSavedMessage}
        />
        <HistorySection
          {publishHistoryStore}
          {collectionsStore}
          onOpenEntry={openHistoryEntry}
        />
      </div>
    </div>
  {/if}
</div>

<SearchMessagesModal
  isOpen={isSearchOpen}
  {collectionsStore}
  {publishHistoryStore}
  onOpenMessage={openSavedMessage}
  onOpenEntry={openHistoryEntry}
/>
