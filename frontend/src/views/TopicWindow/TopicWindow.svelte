<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { Events } from "@wailsio/runtime";
  import connections from "@/stores/connections";
  import topicPanelDock from "@/stores/topic-panel-dock";
  import os from "@/stores/env";
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
  import { timelineStartMs } from "./topic-window-timeline";

  // State comes from the window URL the backend opened:
  // /?view=topic&conn=<id>&topic=<encoded>. The topic seeds the first render:
  // a TopicWindowSelect event emitted while this window was still loading
  // would have been dropped, so the URL carries the selection at open time.
  const params = new URLSearchParams(window.location.search);
  const connectionId = parseInt(params.get("conn") ?? "0", 10);
  const initialTopic = params.get("topic") ?? "";

  let selectedTopicStore: SelectedTopicStore | null = null;
  let selectedTopic: string | null = null;
  // Oldest message this window holds, for the timeline's lower bound.
  let oldestMessageMs: number | null = null;
  let storesInitialised = false;
  // A selection emitted while this window is still booting has nowhere to go
  // yet, so it is held here and applied once the stores exist. Only the
  // latest is kept: an earlier topic applied afterwards would be wrong.
  let pendingTopic: string | null = null;
  let storesReady = false;
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

  const applySelection = (topic: string) => {
    if (!selectedTopicStore) return;
    if (topic) {
      selectedTopicStore.selectTopic(topic);
    } else {
      selectedTopicStore.deselectTopic();
    }
  };

  onMount(async () => {
    // Registered before the store init below, not after: an event arriving
    // during that await would otherwise be dropped and the window would sit
    // on a stale topic.
    //
    // Follows topic selection in the main window, like DevTools follows the
    // page: the main window emits this whenever the mode is "window" and the
    // selected topic changes there (including deselect, with an empty topic).
    unlistenTopicSelect = Events.On(
      events.GlobalEvent.TopicWindowSelect,
      (e) => {
        const data = e.data as { connectionId: number; topic: string };
        if (data.connectionId !== connectionId) return;
        if (!storesReady) {
          pendingTopic = data.topic;
          return;
        }
        applySelection(data.topic);
      }
    );

    // env feeds the macOS traffic-light inset in the panel header.
    await Promise.all([os.init(), connections.init(), topicPanelDock.init()]);
    storesInitialised = true;
    const connection = get(connections).connections[connectionId];
    if (!connection) {
      return;
    }
    selectedTopicStore = createSelectedTopicStore(
      connectionId,
      connection.eventSet
    );
    unsubscribeSelectedTopicStore = selectedTopicStore.subscribe((store) => {
      selectedTopic = store.selectedTopic;
      // History is oldest-first, so [0] is the earliest message held.
      oldestMessageMs = store.history[0]?.timeMs ?? null;
    });

    if (initialTopic) {
      selectedTopicStore.selectTopic(initialTopic);
    }

    storesReady = true;
    if (pendingTopic !== null) {
      const topic = pendingTopic;
      pendingTopic = null;
      applySelection(topic);
    }
  });

  onDestroy(() => {
    // Drop the app-global event listeners when the window closes so we don't
    // leak a listener (and a forever-growing history) on the shared backend.
    selectedTopicStore?.destroy();
    unlistenTopicSelect?.();
    unsubscribeSelectedTopicStore?.();
  });

  $: connection = $connections.connections[connectionId];
  // Reactive rather than computed once in onMount: if the connection is
  // deleted while this window is open (the backend also closes the pop-out,
  // but that is native-only), it flips to the not-found state instead of a
  // frozen panel.
  $: error =
    storesInitialised && !connection ? "Connection not found" : "";
  $: mqttVersion = (
    connection?.connectionDetails.mqttVersion === "3" ? "3" : "5"
  ) as "3" | "5";
</script>

<IconContext>
  <main class="h-screen w-screen bg-elevation-0 text-white-text flex flex-col">
    {#if error}
      <div class="size-full flex items-center justify-center text-secondary-text">
        {error}
      </div>
    {:else if selectedTopicStore}
      <div class="grow min-h-0">
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
            firstConnectedAtMs={timelineStartMs(
              connection?.firstConnectedThisSessionAtMs,
              oldestMessageMs,
              Date.now()
            )}
            {mqttVersion}
            openChartWindow={(topic, fields) =>
              OpenChartWindow({ connectionId, topic, fields })}
            dockMode={$topicPanelDock.mode}
            onSetDockMode={(mode) => topicPanelDock.setMode(mode)}
            showCloseButton={false}
            headerDraggable={true}
            headerLeftInset={$os.isMac && !$os.isFullscreen ? 62 : 0}
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
