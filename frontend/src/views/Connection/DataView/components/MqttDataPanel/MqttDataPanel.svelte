<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import SearchActionBar from "./components/SearchActionBar/SearchActionBar.svelte";
  import MqttTopicTree from "./components/MqttTopicTree/MqttTopicTree.svelte";

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

  export let connection: Connection;
  export let selectedTopicStore: SelectedTopicStore;
  export let width: number;

  const mqttHighlightStore = createHighlightedMqttTopicsStore();
  const mqttDataStore = createMqttDataStore(
    mqttHighlightStore,
    connection.eventSet
  );

  const defaultSortState = $defaultSorts[DEFAULT_SORT_PERSIST_KEY];

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
  <SearchActionBar
    getAllTopics={mqttDataStore.getAllTopics}
    {searchStore}
    {expandedTopicsStore}
    {sortStore}
  />
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
</div>
