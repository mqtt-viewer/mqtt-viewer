<script lang="ts">
  import { Events } from "@wailsio/runtime";
  import * as events from "bindings/mqtt-viewer/events/models";
  import Sidebar from "./components/Sidebar/Sidebar.svelte";
  import SelectedTopicDisplay from "./components/SelectedTopicPanel/SelectedTopicPanel.svelte";
  import MqttDataPanel from "./components/MqttDataPanel/MqttDataPanel.svelte";
  import { createSelectedTopicStore } from "./stores/selected-topic-store";
  import type { Connection } from "@/stores/connections";
  import ResizableContainer from "@/components/ResizableContainer/ResizableContainer.svelte";
  import { createMatchedTopicsStore } from "./stores/matched-topics";
  import panelSizes from "@/stores/panel-sizes";
  import topicPanelDock from "@/stores/topic-panel-dock";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import connections from "@/stores/connections";
  import tabs from "@/stores/tabs";
  import {
    DeleteRetainedMessage,
    ExportTopicMessages,
    OpenChartWindow,
    OpenTopicWindow,
  } from "bindings/mqtt-viewer/backend/app/app";

  export let connection: Connection;

  const PUBLISH_PANEL_ID = "publish-panel";
  const SELECTED_TOPIC_PANEL_ID = "selected-topic-panel";
  const SELECTED_TOPIC_PANEL_BOTTOM_ID = "selected-topic-panel-bottom";

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
  $: dockMode = $topicPanelDock.mode;
  // Mutually exclusive by construction (derived from the same dockMode), so
  // at most one SelectedTopicPanel instance ever mounts: the layout still
  // needs two {#if} sites below because "right" and "bottom" live in
  // different DOM parents (outer row vs. the middle column), but exactly one
  // of these two flags - or neither, in "window" mode - can ever be true.
  $: renderedDockSide = isSelectedTopicPanelOpen
    ? dockMode === "right" || dockMode === "bottom"
      ? dockMode
      : null
    : null;
  $: isDockedRight = renderedDockSide === "right";
  $: isDockedBottom = renderedDockSide === "bottom";
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
  // width of data view to make it behave correctly. Only mode "right" takes
  // width away from the data view; "bottom" only takes height, and "window"
  // renders no docked panel in the main window at all.
  $: getDataViewWidth = (params: {
    rootAppWidth: number;
    publishPanelWidth: number;
    isDockedRight: boolean;
    selectedTopicPanelWidth: number;
  }) => {
    let selectedWidth = params.isDockedRight
      ? params.selectedTopicPanelWidth
      : 0;

    return params.rootAppWidth - params.publishPanelWidth - selectedWidth;
  };

  $: dataViewWidth = getDataViewWidth({
    rootAppWidth: $panelSizes.rootWindowWidth,
    publishPanelWidth,
    isDockedRight,
    selectedTopicPanelWidth,
  });

  // Only the active tab drives the pop-out: background tabs keep their
  // DataView mounted (display: none in Connection.svelte), so without this
  // guard a global switch to "window" mode would spawn a pop-out for every
  // tab that has a topic selected.
  $: isActiveTab =
    $tabs.selectedTab === connection.connectionDetails.id &&
    !$tabs.isNewTabSelected;

  // When docked in a separate window, the pop-out follows topic selection in
  // this (main) window, like DevTools follows the page: open the window if
  // needed and emit the topic (including empty, on deselect) whenever it
  // changes while mode is "window". The topic also rides along in the open
  // params so a freshly created window can seed itself from its URL; the
  // event alone would be dropped by a webview that hasn't mounted yet.
  let lastEmittedTopic: string | null | undefined = undefined;
  $: if (dockMode === "window" && isActiveTab) {
    const topic = $selectedTopicStore.selectedTopic;
    if (topic !== lastEmittedTopic) {
      lastEmittedTopic = topic;
      OpenTopicWindow({
        connectionId: connection.connectionDetails.id,
        topic: topic ?? "",
      })
        .then(() => {
          Events.Emit(events.GlobalEvent.TopicWindowSelect, {
            connectionId: connection.connectionDetails.id,
            topic: topic ?? "",
          });
        })
        .catch((e) => {
          addToast({
            data: {
              title: "Failed to open topic window",
              description: e as string,
              type: "error",
            },
          });
        });
    }
  } else {
    // Reset so switching back to "window" mode (or back to this tab) re-sends
    // the current topic.
    lastEmittedTopic = undefined;
  }

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
      maxSize={isDockedRight
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
    <div class="flex flex-col grow min-w-0 min-h-0">
      <div
        class="grow min-h-0 max-w-full overflow-x-hidden overflow-y-auto"
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
          <MqttDataPanel
            {connection}
            {selectedTopicStore}
            width={dataViewWidth}
          />
        {/if}
      </div>
      {#if isDockedBottom}
        <ResizableContainer
          id={SELECTED_TOPIC_PANEL_BOTTOM_ID}
          resizeEdge="top"
          minSize={220}
          maxSize={(2 * $panelSizes.rootWindowHeight) / 3}
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
            openChartWindow={(topic, fields) =>
              OpenChartWindow({
                connectionId: connection.connectionDetails.id,
                topic,
                fields,
              })}
            dockMode={$topicPanelDock.mode}
            onSetDockMode={(mode) => topicPanelDock.setMode(mode)}
          />
        </ResizableContainer>
      {/if}
    </div>
    {#if isDockedRight}
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
          openChartWindow={(topic, fields) =>
            OpenChartWindow({
              connectionId: connection.connectionDetails.id,
              topic,
              fields,
            })}
          dockMode={$topicPanelDock.mode}
          onSetDockMode={(mode) => topicPanelDock.setMode(mode)}
        />
      </ResizableContainer>
    {/if}
  </div>
</div>
