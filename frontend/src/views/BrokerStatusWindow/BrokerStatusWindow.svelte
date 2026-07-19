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
  import TimeRangeSelector from "./components/TimeRangeSelector/TimeRangeSelector.svelte";
  import { nowTick, formatAge } from "./components/BrokerStatusView/raw-browser";

  // State comes from the window URL the backend opened:
  // /?view=status&conn=<id>
  const params = new URLSearchParams(window.location.search);
  const connectionId = parseInt(params.get("conn") ?? "0", 10);

  // How long after opening (or a history clear) with no $SYS before the pill
  // treats the broker as a no-$SYS broker and hides itself.
  const PILL_GRACE_MS = 10_000;

  let store: BrokerStatusStore | null = null;
  let viewRef: BrokerStatusView | null = null;
  let connectionName = "Broker status";
  let error = "";

  // Header state, mirrored from the store via a manual subscription (the store
  // is nullable until onMount, so `$store` auto-subscription is not usable here).
  let sysEverSeen = false;
  let sysLastSeenMs = -1;
  let learnedIntervalMs = 10_000;
  let rangeMinutes = 5;
  let unsubStore: (() => void) | null = null;

  // Pill grace timer, re-armed whenever the store's opened-at clock changes.
  let pillGraceElapsed = false;
  let pillGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastOpenedAt = -1;

  const armPillGrace = (openedAt: number) => {
    pillGraceElapsed = false;
    if (pillGraceTimer) clearTimeout(pillGraceTimer);
    const remaining = Math.max(0, PILL_GRACE_MS - (Date.now() - openedAt));
    pillGraceTimer = setTimeout(() => (pillGraceElapsed = true), remaining);
  };

  const bindHeader = (s: BrokerStatusStore) => {
    unsubStore?.();
    unsubStore = s.subscribe((st) => {
      sysEverSeen = st.sysEverSeen;
      sysLastSeenMs = st.sysLastSeenMs;
      learnedIntervalMs = st.learnedIntervalMs;
      rangeMinutes = st.rangeMinutes;
      if (st.windowOpenedAt !== lastOpenedAt) {
        lastOpenedAt = st.windowOpenedAt;
        armPillGrace(st.windowOpenedAt);
      }
    });
  };

  // Live connection state for the header dot + disconnected banner. Driven by
  // the connections store, which the backend keeps up to date via events.
  $: connectionState =
    $connections.connections[connectionId]?.connectionState ?? "disconnected";
  $: isDisconnected = connectionState === "disconnected";

  // Staleness pill: "waiting for $SYS" until the first message, then
  // "$SYS <age> ago" (greyed once the age exceeds 2x the learned interval).
  // Hidden on brokers that publish no $SYS at all (grace elapsed, none seen).
  $: pillAgeMs = sysLastSeenMs > 0 ? $nowTick - sysLastSeenMs : 0;
  $: pill = sysEverSeen
    ? { show: true, text: `$SYS ${formatAge($nowTick, sysLastSeenMs)}`, grey: pillAgeMs > 2 * learnedIntervalMs }
    : !pillGraceElapsed
      ? { show: true, text: "waiting for $SYS", grey: false }
      : { show: false, text: "", grey: false };

  // When the range is shorter than 5x the learned $SYS interval, the broker
  // series render as sparse points; the note explains why (nothing is disabled).
  $: sparseNote =
    sysEverSeen && rangeMinutes * 60_000 < 5 * learnedIntervalMs
      ? `broker publishes about every ${Math.round(learnedIntervalMs / 1000)}s`
      : undefined;

  const onRangeChange = (e: CustomEvent<number>) => store?.setRange(e.detail);

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
    bindHeader(store);
    // Backfills $SYS + mapped-topic history and begins live-appending from the
    // shared event stream.
    await store.init();
  });

  onDestroy(() => {
    // Drop the app-global event listeners (and the 1 s ticker) when the window
    // closes so we don't leak listeners on the shared backend.
    unsubStore?.();
    if (pillGraceTimer) clearTimeout(pillGraceTimer);
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
        <div class="ml-auto flex items-center gap-3">
          {#if pill.show}
            <span
              class="text-sm tabular-nums {pill.grey
                ? 'text-secondary-text opacity-60'
                : 'text-secondary-text'}"
            >
              {pill.text}
            </span>
          {/if}
          <TimeRangeSelector
            value={rangeMinutes}
            {sparseNote}
            on:change={onRangeChange}
          />
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
      <div class="grow min-h-0 overflow-y-auto" style="--wails-draggable:false">
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
