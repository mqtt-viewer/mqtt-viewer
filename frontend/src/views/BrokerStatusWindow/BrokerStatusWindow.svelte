<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import connections from "@/stores/connections";
  import subscriptions from "@/stores/subscriptions";
  import chartWindows from "@/stores/chart-windows";
  import os from "@/stores/env";
  import IconContext from "@/components/Icon/IconContext.svelte";
  import Toast, { addToast } from "@/components/Toast/Toast.svelte";
  import ConnectionStatusCircle from "@/components/ConnectionStatusCircle/ConnectionStatusCircle.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import {
    clampRange,
    createBrokerStatusStore,
    DEFAULT_RANGE_MINUTES,
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
  let rangeMinutes = DEFAULT_RANGE_MINUTES;
  let unsubStore: (() => void) | null = null;

  // The selected range is persisted per connection in the same key/value table
  // the topic chart uses for its window. The key is namespaced so it can never
  // collide with that table's plain connection-id keys.
  const rangeKey = `status:${connectionId}`;

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

  // Live connection state for the header dot + banner. Driven by the
  // connections store, which the backend keeps up to date via events.
  $: connectionState =
    $connections.connections[connectionId]?.connectionState ?? "disconnected";
  // A connection that has never been up this session has nothing frozen to
  // warn about, so it gets a neutral note rather than a warning banner.
  $: everConnected =
    !!$connections.connections[connectionId]?.firstConnectedThisSessionAtMs;
  // An unexpected outage sits in "reconnecting", not "disconnected"; both mean
  // the values on screen are frozen.
  $: banner =
    connectionState === "connected"
      ? null
      : connectionState === "reconnecting"
        ? { text: "Reconnecting. Values frozen.", warn: true }
        : connectionState === "connecting"
          ? { text: "Connecting…", warn: false }
          : connectionState === "error"
            ? {
                text: everConnected
                  ? "Connection failed. Values frozen."
                  : "Connection failed.",
                warn: true,
              }
            : everConnected
              ? { text: "Disconnected. Values frozen.", warn: true }
              : { text: "Not connected.", warn: false };

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

  // Only a genuine user pick reaches this, so it is also the only place that
  // writes the preference through. The window keeps working if the write
  // fails; the range just resets next time.
  const onRangeChange = (e: CustomEvent<number>) => {
    const minutes = clampRange(e.detail);
    store?.setRange(minutes);
    chartWindows.set(rangeKey, Math.round(minutes * 60)).catch((err) => {
      console.error("Failed to save the broker status time range", err);
      addToast({
        data: {
          title: "Time range",
          description: "Could not save the time range. It will reset on restart.",
          type: "error",
        },
      });
    });
  };

  onMount(async () => {
    // Init subscriptions too so BrokerStatusView's hasSysSubscription reflects
    // reality (otherwise it reads as always-false and the empty state offers a
    // duplicate "$SYS/#" subscription the connection already has). env feeds
    // the macOS traffic-light inset in the header.
    await Promise.all([os.init(), connections.init(), subscriptions.init()]);
    const connection = get(connections).connections[connectionId];
    if (!connection) {
      error = "Connection not found";
      return;
    }
    connectionName = connection.connectionDetails.name;

    // Restore the last range picked for this connection. A failed load must
    // not stop the window opening: fall back to the default.
    let seededRange = DEFAULT_RANGE_MINUTES;
    try {
      await chartWindows.init();
      const seconds = chartWindows.get(rangeKey);
      if (seconds > 0) seededRange = clampRange(seconds / 60);
    } catch (e) {
      console.error("Failed to load the broker status time range", e);
    }

    store = createBrokerStatusStore(connectionId, connection.eventSet, {
      connected: connection.connectionState === "connected",
      rangeMinutes: seededRange,
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
  <main class="h-screen w-screen bg-elevation-0 text-white-text flex flex-col">
    <!-- macOS sits the traffic lights higher than a symmetrically padded row
         centres its content, so on mac the same total height is kept but
         kept at pt-2 so the row's centre stays
         on the lights' centre. Windows and Linux keep the even padding. -->
    <header
      class="flex items-center gap-2 px-4 border-b border-outline {$os.isMac &&
      !$os.isFullscreen
        ? 'pt-2 pb-2'
        : 'py-2'}"
      style="--wails-draggable:drag"
    >
      {#if $os.isMac && !$os.isFullscreen}
        <!-- Clear the macOS traffic lights (frameless hidden-inset titlebar). -->
        <div class="w-[62px] shrink-0" />
      {/if}
      <ConnectionStatusCircle state={connectionState} />
      <!-- The connection name alone. The window title and the dot already say
           what this window is, and the broker facts now live in the health
           strip below, which leaves the name its full width. -->
      <div class="flex min-w-0 flex-1 items-baseline">
        <span class="text-lg text-emphasis truncate">{connectionName}</span>
      </div>
      {#if store}
        <div
          class="ml-auto flex items-center gap-3"
          style="--wails-draggable:false"
        >
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

    {#if banner && !error}
      <div
        class="px-4 py-1.5 text-sm truncate border-b {banner.warn
          ? 'text-warning border-warning'
          : 'text-secondary-text border-outline'}"
      >
        {banner.text}
      </div>
    {/if}

    {#if error}
      <div class="px-4 py-2 text-secondary-text">
        {error}
      </div>
    {:else if store}
      <!-- Scrolls on its own axis so the view's sticky health strip pins to
           the top of the body. A browser tab is much wider than the desktop
           pop-out window, so horizontal overflow is clipped instead of growing
           a scrollbar; the inset that keeps the tile grid off both edges is
           the view's own p-4 (the strip bleeds back out of it with -mx-4). -->
      <div class="grow min-h-0 overflow-y-auto overflow-x-hidden">
        <BrokerStatusView bind:this={viewRef} {store} {connectionId} />
      </div>
    {:else}
      <div class="px-4 py-2 text-secondary-text">
        Loading…
      </div>
    {/if}
    <Toast />
  </main>
</IconContext>
