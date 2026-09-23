<script lang="ts">
  import { onMount } from "svelte";
  import { twMerge } from "tailwind-merge";
  import SearchActionBar from "./components/SearchActionBar/SearchActionBar.svelte";
  import MqttTopicTree from "./components/MqttTopicTree/MqttTopicTree.svelte";
  import SparkplugPanel from "./components/SparkplugPanel/SparkplugPanel.svelte";
  import { metricListJson } from "./components/SparkplugPanel/build-sparkplug-tree";
  import MqttGraphView from "../MqttGraphView/MqttGraphView.svelte";
  import ViewToggle from "./components/ViewToggle/ViewToggle.svelte";

  import { createMqttDataStore } from "./stores/mqtt-data";
  import { createExpandedTopicsStore } from "./stores/expanded-topics";
  import { createSearchStore } from "./stores/search";
  import {
    createSparkplugTreeStore,
    type SparkplugMetric,
    type SparkplugNode,
  } from "./stores/sparkplug-tree-store";
  import type { RebirthTarget } from "../../sparkplug-rebirth";
  import connectionsStore from "@/stores/connections";
  import { errorMessage } from "@/util/strings";
  import {
    createSortStore,
    DEFAULT_SORT_PERSIST_KEY,
    validateSort,
  } from "./stores/sort";
  import type { Connection } from "@/stores/connections";
  import type { SelectedTopicStore } from "../../stores/selected-topic-store";
  import type { PinnedTopicsStore } from "../../stores/pinned-topics";
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
  export let pinnedTopicsStore: PinnedTopicsStore;
  export let width: number;
  // Measured width of the tree's scroll container. The `width` prop is derived
  // arithmetically in DataView (window minus the side panels) and drifts by a
  // few pixels from the real box when the selected-topic panel is docked, which
  // left the row's ellipsis short of the edge. Rows size from the measurement
  // and fall back to the prop until the first layout.
  let treeWidth = 0;
  export let copyTopicPath: (topic: string) => void;
  export let exportTopicMessages: (topic: string) => void;
  export let onClearRetained: (topic: string) => void;
  export let onClearRetainedBelow: (prefix: string) => void;
  /** Opens the rebirth confirmation; nothing is published before it. */
  export let onRequestRebirth: (targets: RebirthTarget[]) => void = () => {};

  const mqttHighlightStore = createHighlightedMqttTopicsStore();
  const mqttDataStore = createMqttDataStore(
    mqttHighlightStore,
    connection.eventSet
  );

  // The graph is only mounted in graph mode (see the {#if view === "list"}
  // below), so callers optional-chain when forwarding to it.
  let graphView: MqttGraphView | undefined;

  // Invalidates the retained marker on both views after a clear succeeds.
  // The tree store is always live regardless of which view is showing; the
  // graph keeps its own separate model, so it needs telling too.
  export const markRetainedCleared = (topics: string[]) => {
    mqttDataStore.markRetainedCleared(topics);
    graphView?.clearRetainedMarks(topics);
  };

  // Reads the tree store rather than fetching: it already holds the latest
  // payload per topic, utf8-decoded by the same path the selected-topic panel
  // uses. Shared with the graph so both views copy identical text.
  const getTopicPayload = (topic: string) => findTopicPayload(get(mqttDataStore), topic);

  const copyPayload = async (topic: string) => {
    const payload = getTopicPayload(topic);
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
  // Recomputed from the store so the item reads "Unpin topic" the moment a
  // pin lands, including one made in another window.
  $: menuIsPinned = menuTopic !== null && $pinnedTopicsStore.set.has(menuTopic);

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
          // The model's own value is the optimistic immediate paint; the
          // backend's retained index is the truth. The frontend message
          // stream is a capped drop-oldest buffer, so under flood the
          // message that would have set isRetained can be lost, and this
          // call is already in flight to get the below-count anyway.
          menuIsRetained = topics.includes(topic);
        }
      })
      .catch((e) => {
        // A count we cannot fetch just means the bulk action stays hidden;
        // the rest of the menu still works. Still worth a warning: a
        // silently missing bulk-clear item is indistinguishable from a
        // logic bug.
        console.warn(`failed to fetch retained topics under "${topic}"`, e);
      });
    return true;
  };

  const sparkplugStore = createSparkplugTreeStore(
    connection.connectionDetails.id,
    connection.eventSet,
    { connected: connection.connectionState === "connected" }
  );
  onMount(() => {
    sparkplugStore.init();
    return () => sparkplugStore.destroy();
  });

  const copyText = async (text: string, what: string) => {
    try {
      await copyToClipboard(text);
    } catch (e) {
      addToast({
        data: {
          title: `Failed to copy ${what}`,
          description: errorMessage(e),
          type: "error",
        },
      });
    }
  };

  const onCopyMetricList = (node: SparkplugNode) =>
    copyText(metricListJson(node), "metric list");

  const onCopyMetricValue = (metric: SparkplugMetric) =>
    copyText(metric.valueRaw, "value");

  // A metric row opens the message that last carried it, not just its topic:
  // under report by exception the topic's newest message often doesn't
  // contain that metric at all.
  const onSelectMetric = (metric: SparkplugMetric) => {
    if ($selectedTopicStore.selectedTopic !== metric.topic) {
      selectedTopicStore.selectTopic(metric.topic);
    }
    if (metric.messageId !== undefined) {
      selectedTopicStore.focusMessage(metric.messageId);
    }
  };

  // With decoding off the Sparkplug payloads never reach the tree, so the
  // Sparkplug view is still offered whenever spBv1.0 topics exist, to explain
  // that and turn it on.
  $: sparkplugTopicsSeen = $mqttDataStore["spBv1.0"] !== undefined;
  $: showSparkplug = $sparkplugStore.hasSparkplug || sparkplugTopicsSeen;
  $: decodingState = $sparkplugStore.hasSparkplug
    ? ("on" as const)
    : connection.connectionDetails.isProtoEnabled
      ? ("needs-reconnect" as const)
      : ("off" as const);

  let enablingDecoding = false;
  const onEnableDecoding = async () => {
    if (enablingDecoding) return;
    enablingDecoding = true;
    const id = connection.connectionDetails.id;
    try {
      if (!connection.connectionDetails.isProtoEnabled) {
        await connectionsStore.updateConnectionDetails({
          ...connection.connectionDetails,
          isProtoEnabled: true,
        });
      }
    } catch (e) {
      addToast({
        data: {
          title: "Failed to turn on Sparkplug decoding",
          description: errorMessage(e),
          type: "error",
        },
      });
      enablingDecoding = false;
      return;
    }
    // The decode middleware is installed on a connect. While the client is
    // retrying on its own, leave it be: interrupting would stop the retries.
    const state = connection.connectionState;
    if (state === "connecting" || state === "reconnecting") {
      enablingDecoding = false;
      return;
    }
    try {
      if (state === "connected") await connectionsStore.disconnect(id);
      await connectionsStore.connect(id);
    } catch (e) {
      addToast({
        data: {
          title: "Sparkplug decoding is on, but connecting failed",
          description: errorMessage(e),
          type: "error",
        },
      });
    } finally {
      enablingDecoding = false;
    }
  };

  const defaultSortState = $defaultSorts[DEFAULT_SORT_PERSIST_KEY];

  // Which view you last used, kept per connection alongside the graph's own
  // preferences, so a connection you work on in the graph opens in the graph
  // next time.
  type DataView = "list" | "graph" | "sparkplug";
  const viewKey = `mqtt-viewer-topicpanel-view:${connection.connectionDetails.id}`;
  const loadView = (): DataView => {
    try {
      const saved = localStorage.getItem(viewKey);
      return saved === "graph" || saved === "sparkplug" ? saved : "list";
    } catch (e) {
      console.error("topic panel view load failed", e);
      return "list";
    }
  };
  const setView = (v: DataView) => {
    preferredView = v;
    try {
      localStorage.setItem(viewKey, v);
    } catch (e) {
      console.error("topic panel view save failed", e);
    }
  };

  let preferredView: DataView = loadView();
  // The Sparkplug option only exists once the connection has seen Sparkplug
  // traffic, so a saved Sparkplug preference shows the list until then.
  $: view =
    preferredView === "sparkplug" && !showSparkplug ? "list" : preferredView;
  // The tree is only decoded and built while its view is showing; opening it
  // replays the backend's snapshot.
  $: sparkplugStore.setActive(view === "sparkplug");

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
      <ViewToggle
        slot="leading"
        {view}
        {showSparkplug}
        sparkplugWarningCount={$sparkplugStore.warningCount}
        onChange={(v) => setView(v)}
      />
    </SearchActionBar>
    <!-- One menu for the whole tree, not one per row: rows are virtualised, so
         a menu instance per row would multiply floating-ui instances across the
         hottest render path. The row under the pointer is resolved on open. -->
    <ContextMenu onOpen={resolveMenuTarget}>
      <div
        slot="trigger"
        class="grow min-w-0 w-full max-w-full overflow-y-auto overflow-x-hidden pl-2 overscroll-none"
        bind:clientWidth={treeWidth}
      >
        <MqttTopicTree
          width={treeWidth || width}
          pinnedTopics={$pinnedTopicsStore.order}
          onUnpin={(topic) => pinnedTopicsStore.unpin(topic)}
          onUnpinAll={() => pinnedTopicsStore.unpinAll()}
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
            isPinned={menuIsPinned}
            onTogglePin={(topic) => pinnedTopicsStore.toggle(topic)}
            onCopyTopic={copyTopicPath}
            onCopyPayload={copyPayload}
            onExport={exportTopicMessages}
            {onClearRetained}
            {onClearRetainedBelow}
          />
        {/if}
      </svelte:fragment>
    </ContextMenu>
  {:else if view === "sparkplug"}
    <SearchActionBar
      getAllTopics={mqttDataStore.getAllTopics}
      {searchStore}
      {expandedTopicsStore}
      {sortStore}
      showTopicControls={false}
      searchPlaceholder="Filter nodes and metrics"
    >
      <ViewToggle
        slot="leading"
        {view}
        {showSparkplug}
        sparkplugWarningCount={$sparkplugStore.warningCount}
        onChange={(v) => setView(v)}
      />
    </SearchActionBar>
    <div
      class="grow min-h-0 min-w-0 w-full max-w-full overflow-hidden"
      bind:clientWidth={treeWidth}
    >
      <SparkplugPanel
        treeState={$sparkplugStore}
        width={treeWidth || width}
        filter={$searchStore.text}
        {decodingState}
        connectionState={connection.connectionState}
        {enablingDecoding}
        {onEnableDecoding}
        onClearWarnings={sparkplugStore.clearWarnings}
        onClearFilter={() => searchStore.setSearchText("")}
        {onRequestRebirth}
        {onCopyMetricList}
        {onSelectMetric}
        onCopyValue={onCopyMetricValue}
      />
    </div>
  {:else}
    <div class="grow min-h-0 w-full">
      <MqttGraphView
        bind:this={graphView}
        {connection}
        {selectedTopicStore}
        {width}
        initialData={$mqttDataStore}
        {getTopicPayload}
        {copyPayload}
        {copyTopicPath}
        {exportTopicMessages}
        {onClearRetained}
        {onClearRetainedBelow}
        {searchStore}
        {pinnedTopicsStore}
      >
        <ViewToggle
          slot="leading"
          {view}
          {showSparkplug}
          sparkplugWarningCount={$sparkplugStore.warningCount}
          onChange={(v) => setView(v)}
        />
      </MqttGraphView>
    </div>
  {/if}
</div>
