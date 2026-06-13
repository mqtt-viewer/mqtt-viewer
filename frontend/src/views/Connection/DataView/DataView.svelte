<script lang="ts">
  import Sidebar from "./components/Sidebar/Sidebar.svelte";
  import SelectedTopicDisplay from "./components/SelectedTopicPanel/SelectedTopicPanel.svelte";
  import MqttDataPanel from "./components/MqttDataPanel/MqttDataPanel.svelte";
  import { createSelectedTopicStore } from "./stores/selected-topic-store";
  import type { Connection } from "@/stores/connections";
  import ResizableContainer from "@/components/ResizableContainer/ResizableContainer.svelte";
  import { createMatchedTopicsStore } from "./stores/matched-topics";
  import panelSizes from "@/stores/panel-sizes";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import connections from "@/stores/connections";
  import {
    DeleteRetainedMessage,
    ExportTopicMessages,
  } from "bindings/mqtt-viewer/backend/app/app";

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
  $: isConnecting =
    connection.connectionState === "connecting" ||
    connection.connectionState === "reconnecting";
  // Fresh tab that has never connected this session: prompt to connect
  // instead of showing an empty topic tree. Once connected (or after a first
  // connect that left retained data), show the tree.
  $: showNotConnectedState =
    !connection.firstConnectedThisSessionAtMs &&
    connection.connectionState !== "connected";

  const connect = async () => {
    try {
      await connections.connect(connection.connectionDetails.id);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to connect",
          description: e as string,
          type: "error",
        },
      });
    }
  };

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

  const exportTopicMessages = async (topic: string) => {
    try {
      const path = await ExportTopicMessages(
        connection.connectionDetails.id,
        topic
      );
      if (path !== "") {
        addToast({
          data: {
            title: "Messages exported",
            description: path,
            type: "success",
          },
        });
      }
    } catch (e) {
      addToast({
        data: {
          title: "Failed to export messages",
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
      <Sidebar
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
      {#if showNotConnectedState}
        <div
          class="size-full flex flex-col items-center justify-center gap-4 bg-elevation-0 text-secondary-text"
        >
          <Icon type="disconnected" size={32} />
          <div class="text-lg text-emphasis">Not connected</div>
          <div class="text-base max-w-[320px] text-center">
            Connect to this broker to start browsing topics and messages.
          </div>
          <Button on:click={connect} disabled={isConnecting}>
            {isConnecting ? "Connecting…" : "Connect"}
          </Button>
        </div>
      {:else}
        <MqttDataPanel {connection} {selectedTopicStore} width={dataViewWidth} />
      {/if}
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
          {exportTopicMessages}
          firstConnectedAtMs={connection.firstConnectedThisSessionAtMs ?? 0}
          mqttVersion={connection.connectionDetails.mqttVersion === "3"
            ? "3"
            : "5"}
        />
      </ResizableContainer>
    {/if}
  </div>
</div>
