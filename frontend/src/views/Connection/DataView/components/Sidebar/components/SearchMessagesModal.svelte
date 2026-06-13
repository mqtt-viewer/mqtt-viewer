<script lang="ts">
  import type * as models from "bindings/mqtt-viewer/backend/models/models";
  import type { Writable } from "svelte/store";
  import moment from "moment";
  import Dialog from "@/components/Dialog/Dialog.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import { highlightJson } from "@/components/CodeEditor/highlighter";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import _ from "lodash";
  import type {
    createPublishHistoryStore,
    PublishHistory,
  } from "../../PublishPanel/stores/publish-history";
  import type { CollectionsStore } from "../stores/collections";
  import SearchableText from "./SearchableText.svelte";

  export let isOpen: Writable<boolean>;
  export let collectionsStore: CollectionsStore;
  export let publishHistoryStore: ReturnType<typeof createPublishHistoryStore>;
  export let onOpenMessage: (message: models.CollectionMessage) => void;
  export let onOpenEntry: (entry: PublishHistory[number]) => void;

  const MAX_RESULTS = 50;

  let query = "";
  // filtering re-highlights every visible payload; debounce keystrokes
  let debouncedQuery = "";
  const syncQuery = _.debounce((q: string) => (debouncedQuery = q), 150);
  $: syncQuery(query);

  const matchesQuery = (
    q: string,
    ...fields: (string | null | undefined)[]
  ) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return fields.some((f) => !!f && f.toLowerCase().includes(needle));
  };

  $: savedMatches = $collectionsStore.collections
    .flatMap((collection) =>
      (collection.messages ?? []).map((message) => ({ collection, message }))
    )
    .filter(({ message }) =>
      matchesQuery(
        debouncedQuery,
        message.name,
        message.topic,
        message.payload,
        message.userProperties
      )
    )
    .slice(0, MAX_RESULTS);

  $: historyMatches = $publishHistoryStore.publishHistory
    .filter((entry) =>
      matchesQuery(
        debouncedQuery,
        entry.topic,
        entry.payload,
        entry.userProperties
      )
    )
    .slice(0, MAX_RESULTS);

  const openMessage = (message: models.CollectionMessage) => {
    $isOpen = false;
    onOpenMessage(message);
  };

  const openEntry = (entry: PublishHistory[number]) => {
    $isOpen = false;
    onOpenEntry(entry);
  };

  const onClose = () => {
    query = "";
  };
</script>

<Dialog {isOpen} startEmpty {onClose}>
  <div class="flex flex-col w-[520px] max-w-[80vw] max-h-[70vh] min-h-0">
    <BaseInput
      bind:value={query}
      name="search-messages"
      icon="search"
      placeholder="Search topic, payload, or headers"
    />
    <div class="grow min-h-0 overflow-y-auto mt-3 flex flex-col gap-4">
      {#if savedMatches.length > 0}
        <div class="flex flex-col gap-1">
          <span class="text-sm font-semibold text-secondary-text"
            >Collections</span
          >
          {#each savedMatches as { collection, message } (message.id)}
            <button
              class="w-full text-left rounded px-2 py-2 hover:bg-hovered text-white-text flex items-center gap-3 min-w-0"
              on:click={() => openMessage(message)}
            >
              <Icon type="message" size={16} />
              <div class="grow min-w-0 space-y-1">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-base font-medium whitespace-nowrap"
                    >{message.name}</span
                  >
                  {#if debouncedQuery}
                    <SearchableText
                      searchTerm={debouncedQuery}
                      isTopic
                      text={message.topic}
                    />
                  {:else}
                    <span class="truncate text-secondary-text min-w-0"
                      >{message.topic}</span
                    >
                  {/if}
                </div>
                {#if message.payload}
                  <div class="font-mono truncate text-secondary-text">
                    {#if debouncedQuery}
                      <SearchableText
                        searchTerm={debouncedQuery}
                        text={message.payload}
                        config={{ contextChars: 30, maxDisplayChars: 50 }}
                      />
                    {:else}
                      {@html highlightJson(message.payload)}
                    {/if}
                  </div>
                {/if}
              </div>
              <div
                class="flex items-center gap-1 text-secondary-text whitespace-nowrap"
              >
                <Icon type="folder" size={14} />
                <span>{collection.name}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}

      <div class="flex flex-col gap-1">
        <span class="text-sm font-semibold text-secondary-text"
          >Previously published</span
        >
        {#if historyMatches.length === 0}
          <div class="text-base text-secondary-text px-2 py-1">
            {query.trim() ? "No matches" : "No publish history yet"}
          </div>
        {/if}
        {#each historyMatches as entry (entry.id)}
          <div class="relative">
            <button
              class="w-full text-left rounded px-2 py-2 hover:bg-hovered text-white-text flex items-center gap-3 min-w-0"
              on:click={() => openEntry(entry)}
            >
              <Icon type="history" size={16} />
              <div class="grow min-w-0 space-y-1">
                {#if debouncedQuery}
                  <SearchableText
                    searchTerm={debouncedQuery}
                    isTopic
                    text={entry.topic}
                  />
                {:else}
                  <div class="truncate pr-2">{entry.topic}</div>
                {/if}
                {#if entry.payload}
                  <div class="font-mono truncate text-secondary-text">
                    {#if debouncedQuery}
                      <SearchableText
                        searchTerm={debouncedQuery}
                        text={entry.payload}
                        config={{ contextChars: 30, maxDisplayChars: 50 }}
                      />
                    {:else}
                      {@html highlightJson(entry.payload)}
                    {/if}
                  </div>
                {/if}
              </div>
              <span class="text-secondary-text whitespace-nowrap mr-6">
                {moment(entry.publishedAt).fromNow()}
              </span>
            </button>
            <IconButton
              class="absolute top-1/2 -translate-y-1/2 right-2"
              tooltipText="Delete from history"
              onClick={(e) => {
                e?.preventDefault();
                e?.stopImmediatePropagation();
                publishHistoryStore.deletePublishEntry(entry.id).catch((err) =>
                  addToast({
                    data: {
                      title: "Failed to delete history entry",
                      description: err as string,
                      type: "error",
                    },
                  })
                );
              }}
            >
              <Icon type="close" size={14} />
            </IconButton>
          </div>
        {/each}
      </div>
    </div>
  </div>
</Dialog>
