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
    DeleteRetainedMessages,
    ExportTopicMessages,
    GetRetainedTopicsUnderPrefix,
    OpenChartWindow,
  } from "bindings/mqtt-viewer/backend/app/app";
  import ConfirmClearRetainedDialog from "./components/ConfirmClearRetainedDialog/ConfirmClearRetainedDialog.svelte";
  import { writable } from "svelte/store";
  import { copyToClipboard } from "@/util/copy";
  import { errorMessage } from "@/util/strings";

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
          description: errorMessage(e),
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

  // Clearing a retained message publishes an empty retained message, which
  // every other client on the broker sees. It used to fire on a single click
  // with no confirmation; both the single-topic and branch cases now route
  // through the dialog below.
  const isClearRetainedOpen = writable(false);
  let clearRetainedTopic = "";
  let clearRetainedTopics: string[] = [];
  // 0 means the single-topic case; a branch shows its count.
  let clearRetainedCount = 0;
  let clearRetainedBusy = false;
  // The panel owns the topic tree and the graph, so it is what has to be told
  // a marker is stale. Absent while the "not connected" state is showing.
  let dataPanel: MqttDataPanel | undefined;

  const requestClearRetained = (topic: string) => {
    clearRetainedTopic = topic;
    clearRetainedTopics = [topic];
    clearRetainedCount = 0;
    isClearRetainedOpen.set(true);
  };

  const requestClearRetainedBelow = async (prefix: string) => {
    let topics: string[];
    try {
      topics = await GetRetainedTopicsUnderPrefix(
        connection.connectionDetails.id,
        prefix
      );
    } catch (e) {
      addToast({
        data: {
          title: "Failed to find retained messages",
          description: errorMessage(e),
          type: "error",
        },
      });
      return;
    }
    // The prefix itself may hold a retained message; the menu offers this
    // action for what is below, so clearing the branch must not silently take
    // the topic you right-clicked with it.
    const below = topics.filter((t) => t !== prefix);
    // The count on the menu item was fetched when the menu opened, so another
    // client can clear the lot in between. Say so: asking for three things and
    // getting silence reads as a broken button.
    if (below.length === 0) {
      addToast({
        data: {
          title: "Nothing left to clear",
          description: prefix,
          descriptionStyle: "code",
          type: "info",
        },
      });
      return;
    }
    clearRetainedTopic = prefix;
    // Capture the exact list now. The dialog's number is a promise about what
    // gets cleared, so it must not be re-resolved after the user agrees to it.
    clearRetainedTopics = below;
    clearRetainedCount = below.length;
    isClearRetainedOpen.set(true);
  };

  const confirmClearRetained = async () => {
    const topics = clearRetainedTopics;
    const prefix = clearRetainedTopic;
    clearRetainedBusy = true;
    try {
      if (clearRetainedCount === 0) {
        await DeleteRetainedMessage(connection.connectionDetails.id, topics[0]);
        // Only the backend index self-heals; the tree and the graph hold their
        // own copies, and on MQTT 3 no arriving message will ever correct them.
        dataPanel?.markRetainedCleared(topics);
        addToast({
          data: {
            title: "Retained message cleared",
            description: topics[0],
            descriptionStyle: "code",
            type: "success",
          },
        });
      } else {
        // The counts come back from attempted publishes, not from the length
        // of the list I handed over, so the number reported is the number that
        // actually went.
        const result = await DeleteRetainedMessages(
          connection.connectionDetails.id,
          topics
        );
        if (result.cleared > 0) dataPanel?.markRetainedCleared(topics);
        const attempted = result.cleared + result.failed;
        if (result.failed === 0) {
          addToast({
            data: {
              title: `${result.cleared} retained ${
                result.cleared === 1 ? "message" : "messages"
              } cleared`,
              description: prefix,
              descriptionStyle: "code",
              type: "success",
            },
          });
        } else {
          addToast({
            data: {
              title: `Cleared ${result.cleared} of ${attempted} retained messages`,
              description: result.firstError,
              descriptionStyle: "code",
              type: "error",
            },
          });
        }
      }
    } catch (e) {
      addToast({
        data: {
          title: "Failed to clear retained messages",
          description: errorMessage(e),
          type: "error",
        },
      });
    } finally {
      clearRetainedBusy = false;
      isClearRetainedOpen.set(false);
    }
  };

  const copyTopicPath = async (topic: string) => {
    try {
      await copyToClipboard(topic);
    } catch (e) {
      addToast({
        data: {
          title: "Failed to copy topic path",
          description: errorMessage(e),
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
            descriptionStyle: "code",
            type: "success",
          },
        });
      }
    } catch (e) {
      addToast({
        data: {
          title: "Failed to export messages",
          description: errorMessage(e),
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
        <MqttDataPanel
          bind:this={dataPanel}
          {connection}
          {selectedTopicStore}
          width={dataViewWidth}
          {copyTopicPath}
          {exportTopicMessages}
          onClearRetained={requestClearRetained}
          onClearRetainedBelow={requestClearRetainedBelow}
        />
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
          {exportTopicMessages}
          {copyTopicPath}
          onClearRetained={requestClearRetained}
          onClearRetainedBelow={requestClearRetainedBelow}
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
        />
      </ResizableContainer>
    {/if}
  </div>
</div>

<!-- One dialog for every surface: the tree menu, the graph menu, and the
     selected-topic panel all raise their clear requests here, so the
     confirmation wording and the clear itself cannot drift between them. -->
<ConfirmClearRetainedDialog
  isOpen={isClearRetainedOpen}
  topic={clearRetainedTopic}
  count={clearRetainedCount}
  topics={clearRetainedTopics}
  busy={clearRetainedBusy}
  onConfirm={confirmClearRetained}
/>
