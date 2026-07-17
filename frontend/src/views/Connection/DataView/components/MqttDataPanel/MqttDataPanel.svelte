<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import SearchActionBar from "./components/SearchActionBar/SearchActionBar.svelte";
  import MqttTopicTree from "./components/MqttTopicTree/MqttTopicTree.svelte";
  import MqttGraphView from "../MqttGraphView/MqttGraphView.svelte";
  import ViewToggle from "./components/ViewToggle/ViewToggle.svelte";

  import { createMqttDataStore } from "./stores/mqtt-data";
  import { createExpandedTopicsStore } from "./stores/expanded-topics";
  import { createSearchStore } from "./stores/search";
  import {
    createSortStore,
    DEFAULT_SORT_PERSIST_KEY,
    type MqttDataSortDirection,
    type MqttDataSortKey,
  } from "./stores/sort";
  import type { Connection } from "@/stores/connections";
  import type { SelectedTopicStore } from "../../stores/selected-topic-store";
  import { createHighlightedMqttTopicsStore } from "./stores/highlighted-topics";
  import defaultSorts from "@/stores/default-sorts";
  import { get } from "svelte/store";
  import ContextMenu from "@/components/ContextMenu/ContextMenu.svelte";
  import TopicContextMenu from "../TopicContextMenu/TopicContextMenu.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { copyToClipboard } from "@/util/copy";
  import {
    findTopicIsRetained,
    findTopicPayload,
    formatPayloadForCopy,
  } from "../../payload-copy";
  import { GetRetainedTopicsUnderPrefix } from "bindings/mqtt-viewer/backend/app/app";

  export let connection: Connection;
  export let selectedTopicStore: SelectedTopicStore;
  export let width: number;
  export let copyTopicPath: (topic: string) => void;
  export let exportTopicMessages: (topic: string) => void;
  export let onClearRetained: (topic: string) => void;
  export let onClearRetainedBelow: (prefix: string) => void;

  const mqttHighlightStore = createHighlightedMqttTopicsStore();
  const mqttDataStore = createMqttDataStore(
    mqttHighlightStore,
    connection.eventSet
  );

  // Copying a payload reads the tree store rather than fetching: the store
  // already holds the latest payload per topic, utf8-decoded by the same path
  // the selected-topic panel uses.
  const copyPayload = async (topic: string) => {
    const payload = findTopicPayload(get(mqttDataStore), topic);
    if (payload === null) return;
    try {
      await copyToClipboard(formatPayloadForCopy(payload));
    } catch (e) {
      addToast({
        data: {
          title: "Failed to copy payload",
          description: e as string,
          type: "error",
        },
      });
    }
  };

  // What the tree's context menu is currently acting on. Resolved when the menu
  // opens, from the row under the pointer.
  let menuTopic: string | null = null;
  let menuHasPayload = false;
  let menuIsRetained = false;
  let menuRetainedBelowCount = 0;

  /**
   * Resolve which row was right-clicked, and set up what the menu renders.
   * Returns false over empty space so no menu opens.
   *
   * The count of retained messages below is fetched here, once per menu open,
   * rather than being tracked per row: rows are virtualised and re-render on
   * every message batch, so a per-row count would be paid thousands of times a
   * second to answer a question nobody asked.
   */
  const resolveMenuTarget = (event: MouseEvent) => {
    const row = (event.target as HTMLElement | null)?.closest?.("[data-topic]");
    const topic = row?.getAttribute("data-topic") ?? null;
    if (topic === null) return false;

    const data = get(mqttDataStore);
    menuTopic = topic;
    menuHasPayload = findTopicPayload(data, topic) !== null;
    menuIsRetained = findTopicIsRetained(data, topic);
    menuRetainedBelowCount = 0;
    GetRetainedTopicsUnderPrefix(connection.connectionDetails.id, topic)
      .then((topics) => {
        // The menu offers to clear what is *below* the topic, so the topic's
        // own retained message (already offered separately) is not counted.
        if (menuTopic === topic) {
          menuRetainedBelowCount = topics.filter((t) => t !== topic).length;
        }
      })
      .catch(() => {
        // A count we cannot fetch just means the bulk action stays hidden;
        // the rest of the menu still works, so this is not worth a toast.
      });
    return true;
  };

  const defaultSortState = $defaultSorts[DEFAULT_SORT_PERSIST_KEY];

  let view: "list" | "graph" = "list";

  const expandedTopicsStore = createExpandedTopicsStore();
  const searchStore = createSearchStore();
  const sortStore = createSortStore(
    defaultSortState
      ? {
          key: defaultSortState.sortCriteria as MqttDataSortKey,
          dir: defaultSortState.sortDirection as MqttDataSortDirection,
        }
      : undefined
  );
</script>

<div class={twMerge("bg-elevation-0 h-full w-full min-w-0 flex flex-col")}>
  {#if view === "list"}
    <SearchActionBar
      getAllTopics={mqttDataStore.getAllTopics}
      {searchStore}
      {expandedTopicsStore}
      {sortStore}
    >
      <ViewToggle slot="leading" {view} onChange={(v) => (view = v)} />
    </SearchActionBar>
    <!-- One menu for the whole tree, not one per row: rows are virtualised, so
         a menu instance per row would multiply floating-ui instances across the
         hottest render path. The row under the pointer is resolved on open. -->
    <ContextMenu onOpen={resolveMenuTarget}>
      <div
        slot="trigger"
        class="grow min-w-0 w-full max-w-full overflow-y-auto overflow-x-hidden pl-2 overscroll-none"
      >
        <MqttTopicTree
          {width}
          selectedTopic={$selectedTopicStore.selectedTopic}
          mqttData={$mqttDataStore}
          highlightedTopicStore={mqttHighlightStore}
          {expandedTopicsStore}
          sortKey={$sortStore.key}
          sortDir={$sortStore.dir}
          searchText={$searchStore.text}
          onTopicSelect={(row) => {
            if (row.message === undefined) {
              expandedTopicsStore.toggleMqttTopicExpansion(row.topic);
            } else if ($selectedTopicStore.selectedTopic !== row.topic) {
              selectedTopicStore.selectTopic(row.topic);
            }
          }}
        />
      </div>
      <svelte:fragment slot="menu-content">
        {#if menuTopic !== null}
          <TopicContextMenu
            topic={menuTopic}
            hasPayload={menuHasPayload}
            isRetained={menuIsRetained}
            retainedBelowCount={menuRetainedBelowCount}
            onCopyTopic={copyTopicPath}
            onCopyPayload={copyPayload}
            onExport={exportTopicMessages}
            {onClearRetained}
            {onClearRetainedBelow}
          />
        {/if}
      </svelte:fragment>
    </ContextMenu>
  {:else}
    <div class="grow min-h-0 w-full">
      <MqttGraphView
        {connection}
        {selectedTopicStore}
        {width}
        initialData={$mqttDataStore}
        {mqttDataStore}
        {copyTopicPath}
        {exportTopicMessages}
        {onClearRetained}
        {onClearRetainedBelow}
      >
        <ViewToggle slot="leading" {view} onChange={(v) => (view = v)} />
      </MqttGraphView>
    </div>
  {/if}
</div>
