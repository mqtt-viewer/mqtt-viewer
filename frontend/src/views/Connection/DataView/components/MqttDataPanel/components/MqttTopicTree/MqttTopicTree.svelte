<script lang="ts">
  import MqttTopicRow from "./MqttTopicRow.svelte";
  //@ts-ignore
  import VirtualList from "@sveltejs/svelte-virtual-list";
  import type { MqttData } from "../../stores/mqtt-data";
  import type {
    MqttDataSortDirection,
    MqttDataSortKey,
  } from "../../stores/sort";
  import type { ExpandedTopicsStore } from "../../stores/expanded-topics";
  import _ from "lodash";
  import { buildTree, type TreeRow } from "./build-tree";
  import type { HighlightedMqttTopicsStore } from "../../stores/highlighted-topics";

  export let width: number;
  export let selectedTopic: string | null;
  export let expandedTopicsStore: ExpandedTopicsStore;
  export let highlightedTopicStore: HighlightedMqttTopicsStore;
  export let mqttData: MqttData;
  export let searchText: string;
  export let sortKey: MqttDataSortKey;
  export let sortDir: MqttDataSortDirection;
  export let onTopicSelect: (topic: TreeRow) => void;

  $: treeData = buildTree({
    data: mqttData,
    expandedTopics: $expandedTopicsStore,
    sortKey,
    sortDir,
    searchText,
  });
</script>

<VirtualList items={treeData} let:item itemHeight={19}>
  {@const marginLeftPx = item.levelCount * 18}
  {@const maxWidth = width - marginLeftPx - 8}
  <div class="flex">
    <div style:min-width={`${marginLeftPx}px`}></div>
    <div class="grow min-w-0 truncate" style:max-width={`${maxWidth}px`}>
      <MqttTopicRow
        topic={item.expandKey}
        isDecodedProto={item.isDecodedProto}
        isSelected={selectedTopic === item.topic}
        isExpanded={item.isExpanded}
        topicLevel={item.topicLevel}
        expandKey={item.expandKey}
        message={item.message}
        subtopicCount={item.countSubtopicTotal}
        messageCount={item.countMessage}
        toggleExpansion={expandedTopicsStore.toggleMqttTopicExpansion}
        onTopicSelect={() => onTopicSelect(item)}
        {highlightedTopicStore}
      />
    </div>
  </div>
</VirtualList>
