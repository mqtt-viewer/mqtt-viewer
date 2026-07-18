<script lang="ts">
  import { onMount } from "svelte";
  import { twMerge } from "tailwind-merge";
  import Button from "@/components/Button/Button.svelte";
  import SearchActionBar from "./components/SearchActionBar/SearchActionBar.svelte";
  import MqttTopicTree from "./components/MqttTopicTree/MqttTopicTree.svelte";
  import SparkplugPanel from "./components/SparkplugPanel/SparkplugPanel.svelte";
  import { metricListJson } from "./components/SparkplugPanel/build-sparkplug-tree";

  import { createMqttDataStore } from "./stores/mqtt-data";
  import { createExpandedTopicsStore } from "./stores/expanded-topics";
  import { createSearchStore } from "./stores/search";
  import {
    createSparkplugTreeStore,
    type SparkplugNode,
  } from "./stores/sparkplug-tree-store";
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
  import { PublishSparkplugRebirth } from "bindings/mqtt-viewer/backend/app/app";

  export let connection: Connection;
  export let selectedTopicStore: SelectedTopicStore;
  export let width: number;

  const mqttHighlightStore = createHighlightedMqttTopicsStore();
  const mqttDataStore = createMqttDataStore(
    mqttHighlightStore,
    connection.eventSet
  );

  const sparkplugStore = createSparkplugTreeStore(
    connection.connectionDetails.id,
    connection.eventSet,
    { connected: connection.connectionState === "connected" }
  );
  onMount(() => {
    sparkplugStore.init();
    return () => sparkplugStore.destroy();
  });

  // "List" is exactly what exists today; the toggle only appears once the
  // connection has seen Sparkplug traffic, and the mode falls back to List
  // when that traffic disappears (e.g. history cleared).
  let dataMode: "list" | "sparkplug" = "list";
  $: if (!$sparkplugStore.hasSparkplug && dataMode === "sparkplug") {
    dataMode = "list";
  }

  const onRequestRebirth = async (group: string, node: string) => {
    try {
      await PublishSparkplugRebirth(
        connection.connectionDetails.id,
        group,
        node
      );
    } catch (e) {
      console.error("sparkplug: rebirth request failed", e);
    }
  };

  const onCopyMetricList = async (node: SparkplugNode) => {
    try {
      await navigator.clipboard.writeText(metricListJson(node));
    } catch (e) {
      console.error("sparkplug: copy metric list failed", e);
    }
  };

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
  {#if $sparkplugStore.hasSparkplug}
    <div class="flex items-center gap-1 px-2 py-0.5 text-sm select-none">
      <Button
        variant="text"
        class={dataMode === "list" ? "text-white-text" : "text-secondary-text"}
        on:click={() => (dataMode = "list")}>List</Button
      >
      <Button
        variant="text"
        class={dataMode === "sparkplug"
          ? "text-white-text"
          : "text-secondary-text"}
        on:click={() => (dataMode = "sparkplug")}
        >Sparkplug{#if $sparkplugStore.warningCount > 0}<span
            class="text-warning text-xs ml-1"
            >({$sparkplugStore.warningCount})</span
          >{/if}</Button
      >
    </div>
  {/if}
  {#if dataMode === "sparkplug"}
    <div class="grow min-w-0 w-full max-w-full overflow-hidden">
      <SparkplugPanel
        treeState={$sparkplugStore}
        {width}
        filter={$searchStore.text}
        {onRequestRebirth}
        {onCopyMetricList}
      />
    </div>
  {:else}
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
  {/if}
</div>
