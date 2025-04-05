<script lang="ts">
  import PublishPanel from "./components/PublishPanel/PublishPanel.svelte";
  import SelectedTopicDisplay from "./components/SelectedTopicPanel/SelectedTopicPanel.svelte";
  import MqttDataPanel from "./components/MqttDataPanel/MqttDataPanel.svelte";
  import { createSelectedTopicStore } from "./stores/selected-topic-store";
  import type { Connection } from "@/stores/connections";
  import ResizableContainer from "@/components/ResizableContainer/ResizableContainer.svelte";
  import { createMatchedTopicsStore } from "./stores/matched-topics";
  import panelSizes from "@/stores/panel-sizes";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import { DeleteRetainedMessage } from "wailsjs/go/app/App";

  export let connection: Connection;

  const PUBLISH_PANEL_ID = "publish-panel";
  const SELECTED_TOPIC_PANEL_ID = "selected-topic-panel";

  const selectedTopicStore = createSelectedTopicStore(
    connection.connectionDetails.id,
    connection.eventSet
  );

  const matchedTopicsStore = createMatchedTopicsStore(
    connection.connectionDetails.id
  );

  $: connection.connectionState,
    (() => {
      if (connection.connectionState === "disconnected") {
        matchedTopicsStore.clearCache();
        selectedTopicStore.deselectTopic();
      }
    })();

  let publishPanelWidth: number;
  let selectedTopicPanelWidth: number;

  let isPublishPanelOpen =
    $panelSizes.resizablePanelSizes["publish-panel"]?.isOpen ?? true;
  $: isSelectedTopicPanelOpen = $selectedTopicStore.selectedTopic !== null;
  $: isPublishDisabled = connection.connectionState !== "connected";

  // Unfortunately I can't get the behaviour I'd like due
  // to fit-content/flex limitations, so I'm manually calculating the
  // width of data view to make it behave correctly.
  $: getDataViewWidth = (params: {
    rootAppWidth: number;
    publishPanelWidth: number;
    isSelectedTopicPanelOpen: boolean;
    selectedTopicPanelWidth: number;
  }) => {
    let selectedWidth = params.isSelectedTopicPanelOpen
      ? params.selectedTopicPanelWidth
      : 0;

    return params.rootAppWidth - params.publishPanelWidth - selectedWidth;
  };

  $: dataViewWidth = getDataViewWidth({
    rootAppWidth: $panelSizes.rootWindowWidth,
    publishPanelWidth,
    isSelectedTopicPanelOpen,
    selectedTopicPanelWidth,
  });

  const deleteRetainedMessage = async (topic: string) => {
    try {
      await DeleteRetainedMessage(connection.connectionDetails.id, topic);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to delete retained message",
          description: e as string,
          type: "error",
        },
      });
    }
  };
</script>

<div class="flex flex-col w-full h-full max-h-full max-w-full">
  <div class="flex grow w-full min-h-0">
    <ResizableContainer
      id={PUBLISH_PANEL_ID}
      resizeEdge="right"
      collapsed={!isPublishPanelOpen}
      minSize={275}
      maxSize={isSelectedTopicPanelOpen
        ? $panelSizes.rootWindowWidth / 3
        : $panelSizes.rootWindowWidth / 2}
      bind:width={publishPanelWidth}
    >
      <PublishPanel
        {connection}
        {isPublishDisabled}
        getTopicMatchesSubscription={matchedTopicsStore.getTopicMatch}
        isOpen={isPublishPanelOpen}
        open={() => (isPublishPanelOpen = true)}
        close={() => (isPublishPanelOpen = false)}
      />
    </ResizableContainer>
    <div
      class="grow h-full max-h-full min-w-0 overflow-x-hidden overflow-y-auto"
    >
      <MqttDataPanel {connection} {selectedTopicStore} width={dataViewWidth} />
    </div>
    {#if isSelectedTopicPanelOpen}
      <ResizableContainer
        id={SELECTED_TOPIC_PANEL_ID}
        resizeEdge="left"
        minSize={275}
        maxSize={isPublishPanelOpen
          ? $panelSizes.rootWindowWidth / 3
          : $panelSizes.rootWindowWidth / 2}
        bind:width={selectedTopicPanelWidth}
      >
        <SelectedTopicDisplay
          connectionId={connection.connectionDetails.id}
          {selectedTopicStore}
          {deleteRetainedMessage}
          firstConnectedAtMs={connection.firstConnectedThisSessionAtMs ?? 0}
          mqttVersion={connection.connectionDetails.mqttVersion === "3"
            ? "3"
            : "5"}
        />
      </ResizableContainer>
    {/if}
  </div>
</div>
