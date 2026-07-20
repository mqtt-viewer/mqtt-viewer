<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { Events } from "@wailsio/runtime";
  import connections from "@/stores/connections";
  import topicPanelDock from "@/stores/topic-panel-dock";
  import * as events from "bindings/mqtt-viewer/events/models";
  import {
    DeleteRetainedMessage,
    ExportTopicMessages,
    OpenChartWindow,
  } from "bindings/mqtt-viewer/backend/app/app";
  import IconContext from "@/components/Icon/IconContext.svelte";
  import Toast from "@/components/Toast/Toast.svelte";
  import {
    createSelectedTopicStore,
    type SelectedTopicStore,
  } from "@/views/Connection/DataView/stores/selected-topic-store";
  import SelectedTopicPanel from "@/views/Connection/DataView/components/SelectedTopicPanel/SelectedTopicPanel.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";

  // State comes from the window URL the backend opened:
  // /?view=topic&conn=<id>&topic=<encoded>. The topic seeds the first render:
  // a TopicWindowSelect event emitted while this window was still loading
  // would have been dropped, so the URL carries the selection at open time.
  const params = new URLSearchParams(window.location.search);
  const connectionId = parseInt(params.get("conn") ?? "0", 10);
  const initialTopic = params.get("topic") ?? "";

  let selectedTopicStore: SelectedTopicStore | null = null;
  let selectedTopic: string | null = null;
  let error = "";
  let unlistenTopicSelect: (() => void) | null = null;
  let unsubscribeSelectedTopicStore: (() => void) | null = null;

  const deleteRetainedMessage = async (topic: string) => {
    try {
      await DeleteRetainedMessage(connectionId, topic);
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
      const path = await ExportTopicMessages(connectionId, topic);
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

  onMount(async () => {
    await Promise.all([connections.init(), topicPanelDock.init()]);
    const connection = get(connections).connections[connectionId];
    if (!connection) {
      error = "Connection not found";
      return;
    }
    selectedTopicStore = createSelectedTopicStore(
      connectionId,
      connection.eventSet
    );
    unsubscribeSelectedTopicStore = selectedTopicStore.subscribe((store) => {
      selectedTopic = store.selectedTopic;
    });

    if (initialTopic) {
      selectedTopicStore.selectTopic(initialTopic);
    }

    // Follows topic selection in the main window, like DevTools follows the
    // page: the main window emits this whenever the mode is "window" and the
    // selected topic changes there (including deselect, with an empty topic).
    unlistenTopicSelect = Events.On(
      events.GlobalEvent.TopicWindowSelect,
      (e) => {
        const data = e.data as { connectionId: number; topic: string };
        if (data.connectionId !== connectionId || !selectedTopicStore) return;
        if (data.topic) {
          selectedTopicStore.selectTopic(data.topic);
        } else {
          selectedTopicStore.deselectTopic();
        }
      }
    );
  });

  onDestroy(() => {
    // Drop the app-global event listeners when the window closes so we don't
    // leak a listener (and a forever-growing history) on the shared backend.
    selectedTopicStore?.destroy();
    unlistenTopicSelect?.();
    unsubscribeSelectedTopicStore?.();
  });

  $: connection = $connections.connections[connectionId];
  $: mqttVersion = (
    connection?.connectionDetails.mqttVersion === "3" ? "3" : "5"
  ) as "3" | "5";
</script>

<IconContext>
  <main
    class="h-screen w-screen bg-elevation-0 text-white-text flex flex-col"
    style="--wails-draggable:drag"
  >
    {#if error}
      <div class="size-full flex items-center justify-center text-secondary-text">
        {error}
      </div>
    {:else if selectedTopicStore}
      <div class="grow min-h-0" style="--wails-draggable:false">
        {#if selectedTopic === null}
          <div
            class="size-full flex items-center justify-center text-secondary-text"
          >
            No topic selected
          </div>
        {:else}
          <SelectedTopicPanel
            {connectionId}
            {selectedTopicStore}
            {deleteRetainedMessage}
            {exportTopicMessages}
            firstConnectedAtMs={connection?.firstConnectedThisSessionAtMs ?? 0}
            {mqttVersion}
            openChartWindow={(topic, fields) =>
              OpenChartWindow({ connectionId, topic, fields })}
            dockMode={$topicPanelDock.mode}
            onSetDockMode={(mode) => topicPanelDock.setMode(mode)}
            showCloseButton={false}
          />
        {/if}
      </div>
    {:else}
      <div class="size-full flex items-center justify-center text-secondary-text">
        Loading…
      </div>
    {/if}
    <Toast />
  </main>
</IconContext>
