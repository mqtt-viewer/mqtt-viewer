<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import connections from "@/stores/connections";
  import subscriptions from "@/stores/subscriptions";
  import IconContext from "@/components/Icon/IconContext.svelte";
  import Toast from "@/components/Toast/Toast.svelte";
  import ConnectionStatusCircle from "@/components/ConnectionStatusCircle/ConnectionStatusCircle.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import {
    createBrokerStatusStore,
    type BrokerStatusStore,
  } from "./broker-status-store";
  import BrokerStatusView from "./components/BrokerStatusView/BrokerStatusView.svelte";

  // State comes from the window URL the backend opened:
  // /?view=status&conn=<id>
  const params = new URLSearchParams(window.location.search);
  const connectionId = parseInt(params.get("conn") ?? "0", 10);

  let store: BrokerStatusStore | null = null;
  let viewRef: BrokerStatusView | null = null;
  let connectionName = "Broker status";
  let error = "";

  // Live connection state for the header dot + disconnected banner. Driven by
  // the connections store, which the backend keeps up to date via events.
  $: connectionState =
    $connections.connections[connectionId]?.connectionState ?? "disconnected";
  $: isDisconnected = connectionState === "disconnected";

  onMount(async () => {
    // Init subscriptions too so BrokerStatusView's hasSysSubscription reflects
    // reality (otherwise it reads as always-false and the empty state offers a
    // duplicate "$SYS/#" subscription the connection already has).
    await Promise.all([connections.init(), subscriptions.init()]);
    const connection = get(connections).connections[connectionId];
    if (!connection) {
      error = "Connection not found";
      return;
    }
    connectionName = connection.connectionDetails.name;
    store = createBrokerStatusStore(connectionId, connection.eventSet, {
      connected: connection.connectionState === "connected",
    });
    // Backfills $SYS + mapped-topic history and begins live-appending from the
    // shared event stream.
    await store.init();
  });

  onDestroy(() => {
    // Drop the app-global event listeners (and the 1 s ticker) when the window
    // closes so we don't leak listeners on the shared backend.
    store?.destroy();
  });
</script>

<IconContext>
  <main
    class="h-screen w-screen bg-elevation-0 text-white-text flex flex-col"
    style="--wails-draggable:drag"
  >
    <header
      class="flex items-center gap-2 px-4 py-3 min-h-0"
      style="--wails-draggable:false"
    >
      <ConnectionStatusCircle state={connectionState} />
      <span class="text-lg text-emphasis truncate">{connectionName}</span>
      <span class="text-secondary-text text-sm">broker status</span>
      {#if store}
        <div class="ml-auto">
          <IconButton
            tooltipText="Configure metrics"
            tooltipPlacement="bottom"
            onClick={() => viewRef?.openMappingEditor()}
          >
            <Icon type="settings" size={16} />
          </IconButton>
        </div>
      {/if}
    </header>

    {#if isDisconnected && !error}
      <div
        class="px-4 py-1 text-sm text-warning border-y border-warning truncate"
        style="--wails-draggable:false"
      >
        Disconnected. Values frozen.
      </div>
    {/if}

    {#if error}
      <div class="px-4 py-2 text-secondary-text" style="--wails-draggable:false">
        {error}
      </div>
    {:else if store}
      <div class="grow min-h-0" style="--wails-draggable:false">
        <BrokerStatusView bind:this={viewRef} {store} {connectionId} />
      </div>
    {:else}
      <div class="px-4 py-2 text-secondary-text" style="--wails-draggable:false">
        Loading…
      </div>
    {/if}
    <Toast />
  </main>
</IconContext>
