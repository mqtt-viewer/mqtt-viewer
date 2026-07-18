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
    validateSort,
  } from "./stores/sort";
  import type { Connection } from "@/stores/connections";
  import type { SelectedTopicStore } from "../../stores/selected-topic-store";
  import { createHighlightedMqttTopicsStore } from "./stores/highlighted-topics";
  import defaultSorts from "@/stores/default-sorts";

  export let connection: Connection;
  export let selectedTopicStore: SelectedTopicStore;
  export let width: number;

  const mqttHighlightStore = createHighlightedMqttTopicsStore();
  const mqttDataStore = createMqttDataStore(
    mqttHighlightStore,
    connection.eventSet
  );

  const defaultSortState = $defaultSorts[DEFAULT_SORT_PERSIST_KEY];

  let view: "list" | "graph" = "list";

  const expandedTopicsStore = createExpandedTopicsStore();
  const searchStore = createSearchStore();
  const sortStore = createSortStore(
    defaultSortState
      ? validateSort(
          defaultSortState.sortCriteria,
          defaultSortState.sortDirection
        )
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
    <div
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
  {:else}
    <div class="grow min-h-0 w-full">
      <MqttGraphView
        {connection}
        {selectedTopicStore}
        {width}
        initialData={$mqttDataStore}
      >
        <ViewToggle slot="leading" {view} onChange={(v) => (view = v)} />
      </MqttGraphView>
    </div>
  {/if}
</div>
