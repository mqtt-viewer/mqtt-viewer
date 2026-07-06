<script lang="ts">
  import MessageTimeline from "./components/MessageTimeline.svelte";
  import PanelHeader from "@/components/PanelHeader/PanelHeader.svelte";
  import Tabs from "@/components/Tabs/Tabs.svelte";
  import PayloadTab from "./components/PayloadTab.svelte";
  import HeadersTab from "./components/HeadersTab.svelte";
  import UserPropertiesTab from "./components/UserPropertiesTab.svelte";
  import type {
    MqttHistoryMessage,
    SelectedTopicStore,
  } from "../../stores/selected-topic-store";
  import { HISTORY_WINDOW_SIZE } from "../../stores/selected-topic-store";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import SelectedMessageArrivalDetails from "./components/SelectedMessageArrivalDetails.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import Switch from "@/components/InputFields/Switch.svelte";
  import DropdownCloseOnClick from "@/components/DropdownMenu/DropdownCloseOnClick.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Topic from "./components/Topic.svelte";
  import ChartView from "./components/Chart/ChartView.svelte";
  import { createChartSeriesStore } from "./components/Chart/chart-series-store";

  export let connectionId: number;
  export let selectedTopicStore: SelectedTopicStore;
  export let firstConnectedAtMs: number;
  export let mqttVersion: "3" | "5";
  export let deleteRetainedMessage: (topic: string) => Promise<void>;
  export let exportTopicMessages: (topic: string) => Promise<void>;
  // Optional: opens the chart in a separate window (wired by DataView).
  export let openChartWindow:
    | ((topic: string, fields: string[]) => void)
    | null = null;

  $: selectedTopicString = $selectedTopicStore.selectedTopic;

  // Per-topic chart series; reset whenever the selected topic changes.
  const chartSeriesStore = createChartSeriesStore();
  let lastChartedTopic: string | null = null;
  $: if ($selectedTopicStore.selectedTopic !== lastChartedTopic) {
    lastChartedTopic = $selectedTopicStore.selectedTopic;
    chartSeriesStore.clear();
  }

  // Tab control: the Chart tab is last (index 3 for v5 incl. Headers/Properties,
  // index 1 for v3 which only has Payload + Chart).
  let tabsRef: { setTab: (index: number) => void } | null = null;
  let activeTabIndex = 0;
  $: chartTabIndex = mqttVersion === "3" ? 1 : 3;
  $: isChartTabActive = activeTabIndex === chartTabIndex;
  const viewChart = () => tabsRef?.setTab(chartTabIndex);
  // Opens the payload field picker and switches to the Payload tab, so
  // "Add value from payload" lands the user on a ready-to-pick control.
  let showPayloadFieldPicker = false;
  const addFromPayload = () => {
    showPayloadFieldPicker = true;
    tabsRef?.setTab(0);
  };
  const popOut = () =>
    openChartWindow?.(
      $selectedTopicStore.selectedTopic ?? "",
      $chartSeriesStore.map((s) => s.path)
    );

  let selectedMessageId: string | null = null;
  $: selectedMessageIndex = $selectedTopicStore.history.findIndex(
    (message) => message.id === selectedMessageId
  );
  $: selectedMessage =
    selectedMessageIndex !== -1
      ? ($selectedTopicStore.history[
          selectedMessageIndex
        ] as MqttHistoryMessage)
      : null;
  $: selectedMessagePayloadState = selectedMessage?.payloadState ?? null;
  $: selectedMessagePayload = selectedMessage?.payload ?? null;
  $: selectedMessagePayloadB64 = selectedMessage?.payloadB64 ?? null;
  $: selectedMessageRetained = selectedMessage?.retain ?? false;

  // history[] only carries stubs until fetched. Ensure the selected
  // message's payload as soon as it's picked (timeline click or
  // auto-select-latest). Cheap/no-op if already loaded or in flight.
  $: if (selectedMessageId !== null) {
    selectedTopicStore.ensurePayload(selectedMessageId);
  }

  $: selectedMessagePayload,
    (() => {
      // Auto-format to JSON if the payload is a valid JSON string
      try {
        if (selectedMessagePayload === null) {
          return null;
        }
        if ($selectedTopicStore.options.format === "hex") {
          return null;
        }
        JSON.parse(selectedMessagePayload);
        // It's valid JSON
        $selectedTopicStore.options.format = "json-prettier";
      } catch (e) {
        // It isn't valid JSON
        $selectedTopicStore.options.format = "none";
      }
    })();

  $: isComparing = $selectedTopicStore.options.compare;
  $: isAutoSelectingMostRecent = $selectedTopicStore.options.autoSelect;

  $: previousMessageIndex =
    isComparing && selectedMessageIndex !== -1 ? selectedMessageIndex - 1 : -1;
  $: previousMessage =
    previousMessageIndex !== -1
      ? $selectedTopicStore.history[previousMessageIndex]
      : null;
  $: prevMessageRetained = previousMessage?.retain ?? false;
  $: previousMessagePayloadState = previousMessage?.payloadState ?? null;
  $: previousMessagePayload = previousMessage?.payload ?? null;
  // Distinguishes "previous message exists but its payload hasn't landed
  // yet" from "there genuinely is no previous message" for PayloadTab's
  // compare view (both otherwise present as payload === null).
  $: previousMessageLoading =
    previousMessage !== null &&
    previousMessagePayloadState !== "loaded" &&
    previousMessagePayloadState !== "aged-out";
  $: previousMessageAgedOut = previousMessagePayloadState === "aged-out";

  // Compare mode needs the previous message's payload too, still only ever
  // 1-2 messages fetched, never the whole history.
  $: if (isComparing && previousMessage !== null) {
    selectedTopicStore.ensurePayload(previousMessage.id);
  }

  // Windowed durable history (recording on): older/newer/latest navigation.
  $: isDiskHistory = $selectedTopicStore.historySource === "disk";
  $: historyWindow = $selectedTopicStore.window;
  $: totalHistoryCount = $selectedTopicStore.totalCount;
  $: shownHistoryCount = $selectedTopicStore.history.length;
  $: atLatestWindow = historyWindow?.isNewest ?? true;
  $: atOldestWindow = historyWindow?.atOldest ?? true;
  $: isLoadingHistory = $selectedTopicStore.isLoadingHistory;
  $: isLoadingWindow = $selectedTopicStore.isLoadingWindow;
  $: recordingEnabled = $selectedTopicStore.recordingEnabled;
  $: recordedCount = $selectedTopicStore.recordedCount;
</script>

<div
  class="size-full max-h-full flex flex-col
    bg-elevation-1 border-l-[1px] border-l-outline p-4 pt-0"
>
  <PanelHeader
    ><div class="relative min-h-[50px] h-full">
      <div class="flex gap-1 items-center min-h-[50px] max-w-full h-full py-2">
        <Topic topic={selectedTopicString ?? ""} />
        <div class="grow"></div>
        <DropdownMenu>
          <div slot="trigger" class="">
            <IconButton>
              <Icon type="menu" size={16} />
            </IconButton>
          </div>
          <div slot="menu-content" class="flex flex-col gap-5 p-2">
            <Switch
              name="AutoSelectRecent"
              label="Auto-select most recent"
              defaultChecked={isAutoSelectingMostRecent}
              onChange={(checked) => selectedTopicStore.setAutoSelect(checked)}
            />
            <Switch
              name="ComparePreviousPayload"
              label="Compare previous message"
              defaultChecked={isComparing}
              onChange={(checked) => selectedTopicStore.setComparing(checked)}
            />
            <DropdownCloseOnClick>
              <Button
                variant="text"
                on:click={() =>
                  !!$selectedTopicStore.selectedTopic
                    ? exportTopicMessages($selectedTopicStore.selectedTopic)
                    : undefined}
                ><div class="flex mr-[17px] ml-2">
                  <Icon type="download" size={20} />
                </div>
                <span>Export message history</span></Button
              >
            </DropdownCloseOnClick>
            <DropdownCloseOnClick>
              <Button
                variant="text"
                on:click={() =>
                  !!$selectedTopicStore.selectedTopic
                    ? deleteRetainedMessage($selectedTopicStore.selectedTopic)
                    : undefined}
                ><div class="flex mr-[17px] ml-2">
                  <Icon type="delete" size={20} />
                </div>
                <span>Delete retained message</span></Button
              >
            </DropdownCloseOnClick>
          </div>
        </DropdownMenu>
        <IconButton onClick={selectedTopicStore.deselectTopic}>
          <Icon type="close" size={18} />
        </IconButton>
      </div>
    </div></PanelHeader
  >
  <div class="h-[100px] min-h-[100px] overflow-hidden relative">
    {#if isLoadingHistory}
      <div
        class="size-full flex items-center justify-center text-secondary-text"
      >
        Loading history...
      </div>
    {:else}
      <MessageTimeline
        {connectionId}
        {firstConnectedAtMs}
        {selectedTopicStore}
        bind:isAutoSelectingMostRecent={$selectedTopicStore.options.autoSelect}
        onMessageSelect={(id) => {
          selectedMessageId = id;
        }}
      />
    {/if}
  </div>
  {#if !isLoadingHistory && isDiskHistory && totalHistoryCount > shownHistoryCount}
    <div
      class="flex items-center gap-2 text-sm text-secondary-text mt-1 mb-1 select-none"
    >
      <Button
        variant="text"
        iconType="left"
        iconPlacement="left"
        iconSize={12}
        disabled={atOldestWindow || isLoadingWindow !== null}
        on:click={() => selectedTopicStore.loadOlderWindow()}
        >Load older</Button
      >
      <Button
        variant="text"
        iconType="right"
        iconPlacement="right"
        iconSize={12}
        disabled={atLatestWindow || isLoadingWindow !== null}
        on:click={() => selectedTopicStore.loadNewerWindow()}
        >Load newer</Button
      >
      {#if !atLatestWindow}
        <Button variant="text" on:click={() => selectedTopicStore.jumpToLatest()}
          >Jump to latest</Button
        >
      {/if}
      <div class="grow"></div>
      <span class="whitespace-nowrap">
        Showing {shownHistoryCount.toLocaleString()} of {totalHistoryCount.toLocaleString()}
        {atLatestWindow ? "(latest)" : ""}
      </span>
    </div>
  {:else if !isLoadingHistory && !isDiskHistory && recordingEnabled && (recordedCount ?? 0) > 0}
    <div
      class="flex items-center gap-2 text-sm text-secondary-text mt-1 mb-1 select-none"
    >
      <Button
        variant="text"
        on:click={() => selectedTopicStore.loadRecordedHistory()}
        >Load recorded history</Button
      >
      <div class="grow"></div>
      <span class="whitespace-nowrap">
        {(recordedCount ?? 0).toLocaleString()} recorded messages on disk
      </span>
    </div>
  {:else if !isLoadingHistory && !isDiskHistory && !recordingEnabled && shownHistoryCount >= HISTORY_WINDOW_SIZE}
    <div class="text-sm text-secondary-text mt-1 mb-1">
      Showing the latest {HISTORY_WINDOW_SIZE.toLocaleString()} messages. Enable
      recording in settings to browse older history.
    </div>
  {/if}
  {#if isLoadingHistory}
    <!-- The timeline area above already shows the loading state; avoid
      flashing "No message selected" underneath it while history loads. -->
  {:else if selectedMessage === null}
    <div class="mt-12 flex justify-center text-secondary-text">
      No message selected
    </div>
  {:else}
    {#if mqttVersion === "3"}
      <Tabs
        class="w-full grow min-h-0"
        bind:this={tabsRef}
        onTabChange={(i) => (activeTabIndex = i)}
        tabs={[{ title: "Payload" }, { title: "Chart" }]}
      >
        <div slot="tab-1" class="size-full pt-2">
          {#if selectedMessagePayloadState === "aged-out"}
            <div
              class="mt-12 flex flex-col items-center gap-2 px-4 text-center text-secondary-text"
            >
              {#if isDiskHistory}
                <span>
                  No longer on disk. Recorded history prunes the oldest
                  messages to stay within its storage budget.
                </span>
              {:else if recordingEnabled}
                <span>No longer in session memory.</span>
                <Button
                  variant="text"
                  on:click={() => selectedTopicStore.loadRecordedHistory()}
                  >Load recorded history</Button
                >
              {:else}
                <span>
                  No longer in session memory. Enable recording in settings to
                  keep messages across restarts.
                </span>
              {/if}
            </div>
          {:else if selectedMessagePayload !== null}
            <PayloadTab
              bind:codec={$selectedTopicStore.options.decoding}
              bind:format={$selectedTopicStore.options.format}
              bind:showFieldPicker={showPayloadFieldPicker}
              {isComparing}
              payload={selectedMessagePayload}
              payloadB64={selectedMessagePayloadB64}
              payloadLeftForCompare={previousMessagePayload}
              payloadLeftLoading={previousMessageLoading}
              payloadLeftAgedOut={previousMessageAgedOut}
              historySource={$selectedTopicStore.historySource}
              {recordingEnabled}
              onLoadRecordedHistory={() =>
                selectedTopicStore.loadRecordedHistory()}
              {chartSeriesStore}
              onViewChart={viewChart}
            />
          {:else}
            <div class="mt-12 flex justify-center text-secondary-text">
              Loading message...
            </div>
          {/if}
        </div>
        <div slot="tab-2" class="size-full pt-2">
          <ChartView
            {selectedTopicStore}
            {chartSeriesStore}
            topic={selectedTopicString ?? ""}
            onAddFromPayload={addFromPayload}
            onPopOut={openChartWindow ? popOut : null}
            isActive={isChartTabActive}
          />
        </div>
      </Tabs>
    {:else}
      <Tabs
        class="w-full grow min-h-0"
        bind:this={tabsRef}
        onTabChange={(i) => (activeTabIndex = i)}
        tabs={[
          { title: "Payload" },
          { title: "Headers" },
          { title: "Properties" },
          { title: "Chart" },
        ]}
      >
        <div slot="tab-1" class="size-full pt-2">
          {#if selectedMessagePayloadState === "aged-out"}
            <div
              class="mt-12 flex flex-col items-center gap-2 px-4 text-center text-secondary-text"
            >
              {#if isDiskHistory}
                <span>
                  No longer on disk. Recorded history prunes the oldest
                  messages to stay within its storage budget.
                </span>
              {:else if recordingEnabled}
                <span>No longer in session memory.</span>
                <Button
                  variant="text"
                  on:click={() => selectedTopicStore.loadRecordedHistory()}
                  >Load recorded history</Button
                >
              {:else}
                <span>
                  No longer in session memory. Enable recording in settings to
                  keep messages across restarts.
                </span>
              {/if}
            </div>
          {:else if selectedMessagePayload !== null}
            <PayloadTab
              bind:codec={$selectedTopicStore.options.decoding}
              bind:format={$selectedTopicStore.options.format}
              bind:showFieldPicker={showPayloadFieldPicker}
              {isComparing}
              payload={selectedMessagePayload}
              payloadB64={selectedMessagePayloadB64}
              payloadLeftForCompare={previousMessagePayload}
              payloadLeftLoading={previousMessageLoading}
              payloadLeftAgedOut={previousMessageAgedOut}
              historySource={$selectedTopicStore.historySource}
              {recordingEnabled}
              onLoadRecordedHistory={() =>
                selectedTopicStore.loadRecordedHistory()}
              {chartSeriesStore}
              onViewChart={viewChart}
            />
          {:else}
            <div class="mt-12 flex justify-center text-secondary-text">
              Loading message...
            </div>
          {/if}
        </div>
        <div slot="tab-2" class="size-full pt-2">
          {#if !!selectedMessage.properties}
            <HeadersTab
              {isComparing}
              headers={selectedMessage.properties}
              headersToCompare={previousMessage?.properties ?? undefined}
            />
          {/if}
        </div>
        <div slot="tab-3" class="size-full pt-2">
          {#if !!selectedMessage.properties}
            <UserPropertiesTab
              {isComparing}
              userProperties={selectedMessage.properties.userProperties}
              userPropertiesToCompare={previousMessage?.properties
                ?.userProperties}
            />
          {/if}
        </div>
        <div slot="tab-4" class="size-full pt-2">
          <ChartView
            {selectedTopicStore}
            {chartSeriesStore}
            topic={selectedTopicString ?? ""}
            onAddFromPayload={addFromPayload}
            onPopOut={openChartWindow ? popOut : null}
            isActive={isChartTabActive}
          />
        </div>
      </Tabs>
    {/if}
    {#if !isChartTabActive}
      <SelectedMessageArrivalDetails
        class="mt-2"
        {isComparing}
        selectedArrivedAtMs={selectedMessage.timeMs}
        selectedRetain={selectedMessageRetained}
        previousRetain={prevMessageRetained}
        previousArrivedAtMs={previousMessage?.timeMs ?? null}
      />
    {/if}
  {/if}
</div>
