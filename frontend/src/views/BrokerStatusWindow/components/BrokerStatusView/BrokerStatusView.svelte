<script lang="ts">
  // Body of the detached Broker Status window. v2 layout, top to bottom:
  // sticky health strip (or a capability notice when no $SYS card is showing),
  // the traffic hero chart, the loudest-topics table, the gauges grid (with an
  // always-last "+"), the facts row, and the collapsible raw $SYS browser. The
  // v1 no-$SYS empty state + add-subscription CTA is kept. The window shell owns
  // the store's lifecycle and the header (pill + range selector); this view only
  // reads the store and drives the mapping editor.
  import { onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import StatTile from "../StatTile/StatTile.svelte";
  import MetricMappingEditor from "../MetricMappingEditor/MetricMappingEditor.svelte";
  import HealthStrip from "../HealthStrip/HealthStrip.svelte";
  import HeroChart from "../HeroChart/HeroChart.svelte";
  import LoudestTopics from "../LoudestTopics/LoudestTopics.svelte";
  import FactsRow from "../FactsRow/FactsRow.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import Button from "@/components/Button/Button.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import subscriptions from "@/stores/subscriptions";
  import type {
    BrokerStatusStore,
    BrokerStatusState,
    BrokerTileView,
  } from "../../broker-status-store";
  import type { HeroSeries } from "../HeroChart/hero-chart-option";
  import { formatMetricValue } from "../../sys-metrics";
  import { nowTick, formatAge, createRawRateTracker } from "./raw-browser";

  export let store: BrokerStatusStore;
  export let connectionId: number;

  const SYS_TOPIC = "$SYS/#";
  const EMPTY_GRACE_MS = 10_000;
  const MAX_RAW_ROWS = 500;
  // Tile sparklines always span 15 m, so the delta arrow and hover panel name it.
  const TILE_WINDOW = "15m";
  // Minimum gap before a null break is inserted in a hero line (across a
  // disconnect the ticker stops, so consecutive samples jump in time).
  const OBSERVED_GAP_MS = 5_000;

  // Mapping editor, owned here so the "+" tile and pin buttons can open it.
  const editorOpen = writable(false);
  let editorPrefill: { topic?: string; label?: string } | null = null;

  const openAddEditor = () => {
    editorPrefill = null;
    editorOpen.set(true);
  };
  // Also callable by the window shell (header gear) via bind:this.
  export function openMappingEditor() {
    openAddEditor();
  }
  const pinTopic = (topic: string) => {
    const segments = topic.split("/").filter((s) => s !== "");
    editorPrefill = { topic, label: segments[segments.length - 1] ?? topic };
    editorOpen.set(true);
  };

  // Empty-state grace: only offer the "no $SYS" explanation once the window has
  // been open ~10 s without seeing any $SYS message. Re-arm when the store
  // resets its opened-at clock (history cleared); reset the raw-rate tracker
  // there too (its prev-values must not survive a clear).
  const rateTracker = createRawRateTracker();
  let graceElapsed = false;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastOpenedAt = -1;

  const armGrace = (openedAt: number) => {
    graceElapsed = false;
    if (graceTimer) clearTimeout(graceTimer);
    const remaining = Math.max(0, EMPTY_GRACE_MS - (Date.now() - openedAt));
    graceTimer = setTimeout(() => (graceElapsed = true), remaining);
  };

  $: if ($store.windowOpenedAt !== lastOpenedAt) {
    lastOpenedAt = $store.windowOpenedAt;
    rateTracker.reset();
    armGrace($store.windowOpenedAt);
  }

  onDestroy(() => {
    if (graceTimer) clearTimeout(graceTimer);
  });

  $: showEmptyState = !$store.sysEverSeen && $store.connected && graceElapsed;

  // Health strip vs capability notice (deduplicated against the v1 empty card):
  // the strip shows once any chip has data. The notice only stands in when no
  // $SYS has EVER been seen (a broker with $SYS but no health signals gets
  // neither strip nor notice, and a healthy broker's chip warm-up must not
  // flash a false "no $SYS" claim) and the empty card is not already showing.
  $: hasHealth = $store.health.some((c) => c.render);
  $: showCapabilityNotice =
    graceElapsed && !hasHealth && !showEmptyState && !$store.sysEverSeen;

  // In the empty state (no $SYS ever seen, grace elapsed) the builtin tiles can
  // never populate, so hide the ones with no data and show only tiles that
  // actually carry a value (observed rates, any custom tiles with data) plus the
  // always-present "+". During the grace window keep every tile visible so it
  // can still fill in from retained $SYS as messages arrive.
  $: visibleTiles = showEmptyState
    ? $store.tiles.filter((tile) => tile.valueKind !== "empty")
    : $store.tiles;

  // --- Hero series -----------------------------------------------------------
  // Inserts a null break wherever consecutive samples jump more than `maxGapMs`
  // apart (a disconnect gap) so ECharts draws a break instead of bridging it.
  const withGaps = (
    pts: { t: number; v: number | null }[],
    maxGapMs: number
  ): { t: number; v: number | null }[] => {
    if (pts.length < 2) return pts;
    const out: { t: number; v: number | null }[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && pts[i].t - pts[i - 1].t > maxGapMs) {
        out.push({ t: (pts[i - 1].t + pts[i].t) / 2, v: null });
      }
      out.push(pts[i]);
    }
    return out;
  };

  const brokerTooltip = (state: BrokerStatusState, dir: "in" | "out"): string => {
    const a5 = state.metricByKey.get(`msg_rate_${dir}_5min`)?.value ?? null;
    const a15 = state.metricByKey.get(`msg_rate_${dir}_15min`)?.value ?? null;
    let text = "1m average, from the broker";
    const segs: string[] = [];
    if (a5 !== null) segs.push(`5m: ${formatMetricValue(a5)}`);
    if (a15 !== null) segs.push(`15m: ${formatMetricValue(a15)}`);
    if (segs.length > 0) text += `; ${segs.join(", ")}`;
    return text;
  };

  const buildHeroSeries = (state: BrokerStatusState): HeroSeries[] => {
    const m = state.metricByKey;
    const inS = m.get("msg_rate_in")?.samples ?? [];
    const outS = m.get("msg_rate_out")?.samples ?? [];
    const observed = state.observedSeries ?? [];
    const hasBroker = inS.length > 0 || outS.length > 0;
    const brokerGap = Math.max(30_000, 3 * state.learnedIntervalMs);
    const series: HeroSeries[] = [];
    if (inS.length > 0) {
      series.push({
        id: "in",
        label: "In",
        points: withGaps(inS.map((p) => ({ t: p.t, v: p.v })), brokerGap),
        dashed: false,
        emphasis: true,
        tooltip: brokerTooltip(state, "in"),
      });
    }
    if (outS.length > 0) {
      series.push({
        id: "out",
        label: "Out",
        points: withGaps(outS.map((p) => ({ t: p.t, v: p.v })), brokerGap),
        dashed: false,
        emphasis: false,
        tooltip: brokerTooltip(state, "out"),
      });
    }
    // Observed is dashed and muted when broker series are present; promoted to a
    // solid primary line when it stands alone.
    series.push({
      id: "observed",
      label: "Observed",
      points: withGaps(
        observed.map((p) => ({ t: p.t, v: p.v })),
        OBSERVED_GAP_MS
      ),
      dashed: hasBroker,
      emphasis: false,
      tooltip: "this second, as received by this client",
    });
    return series;
  };

  $: heroSeries = buildHeroSeries($store);

  // --- Facts row -------------------------------------------------------------
  $: facts = {
    version: $store.metricByKey.get("version")?.text ?? null,
    uptimeSeconds: $store.metricByKey.get("uptime")?.value ?? null,
    clientsConnected: $store.metricByKey.get("clients_connected")?.value ?? null,
    clientsDisconnected:
      $store.metricByKey.get("clients_disconnected")?.value ?? null,
    clientsExpired: $store.metricByKey.get("clients_expired")?.value ?? null,
    avgMsgSize: $store.metricByKey.get("avg_msg_size")?.value ?? null,
  };

  // --- Gauge tiles: delta arrow + hover-panel inputs -------------------------
  // Percentage change across the visible sparkline window (last vs first). A
  // zero baseline makes a percentage meaningless, so growth from zero returns
  // Infinity and the tile shows the direction glyph without a number.
  const deltaPctFor = (tile: BrokerTileView): number | undefined => {
    // Custom tiles with a unit can be interval scales (temperature and the
    // like) where percent change is meaningless; skip the delta for those.
    if (tile.key.startsWith("custom:") && tile.unit) return undefined;
    const s = tile.samples;
    if (!s || s.length < 2) return undefined;
    const first = s[0].v;
    const last = s[s.length - 1].v;
    if (first === 0) {
      return last === 0 ? undefined : Number.POSITIVE_INFINITY;
    }
    return ((last - first) / Math.abs(first)) * 100;
  };

  // Exact, unabbreviated value string for the tile's hover panel.
  const exactFor = (tile: BrokerTileView): string =>
    tile.valueKind === "number" && !tile.isDuration && tile.value !== null
      ? tile.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : tile.display;

  // Whether this connection still has a $SYS/# subscription row — drives the
  // "Add $SYS/# subscription" CTA in the empty state.
  $: connSubs = $subscriptions.subscriptionsByConnectionId[connectionId] ?? [];
  $: hasSysSubscription = connSubs.some((s) => s.topic === SYS_TOPIC);

  let addingSysSub = false;
  const addSysSubscription = async () => {
    addingSysSub = true;
    try {
      const created = await subscriptions.addSubscription(connectionId);
      if (created) {
        await subscriptions.updateSubscription(connectionId, {
          ...created,
          topic: SYS_TOPIC,
        });
      }
      addToast({
        data: {
          title: "Subscription added",
          description: "Reconnect to apply",
          type: "success",
        },
      });
    } catch (e) {
      console.error("Failed to add $SYS/# subscription", e);
      addToast({
        data: {
          title: "Subscription",
          description: "Could not add the $SYS/# subscription",
          type: "error",
        },
      });
    } finally {
      addingSysSub = false;
    }
  };

  // Raw $SYS browser.
  let rawExpanded = false;
  let rawFilter = "";

  // Only build and sort the entry list while the browser is expanded; when
  // collapsed the header just needs the topic count, which the store's Map gives
  // in O(1). Under a busy broker this skips a sort of every $SYS topic on every
  // flush.
  $: rawEntries = rawExpanded
    ? Array.from($store.latestByTopic.entries())
        .map(([topic, entry]) => ({
          topic,
          value: entry.value,
          timeMs: entry.timeMs,
        }))
        .sort((a, b) => a.topic.localeCompare(b.topic))
    : [];

  $: rawFilterLc = rawFilter.trim().toLowerCase();
  $: rawFiltered =
    rawFilterLc === ""
      ? rawEntries
      : rawEntries.filter((r) => r.topic.toLowerCase().includes(rawFilterLc));
  // Fold each shown row's newest value into the rate tracker and attach its
  // derived /s rate (null for non-counter topics). Idempotent per (topic, time).
  $: rawShown = rawFiltered.slice(0, MAX_RAW_ROWS).map((r) => ({
    ...r,
    rate: rateTracker.update(r.topic, r.value, r.timeMs),
  }));
  $: rawHidden = rawFiltered.length - rawShown.length;
</script>

<div class="flex flex-col gap-4 p-4">
  <!-- Health strip (sticky) or capability notice. -->
  {#if hasHealth}
    <div class="sticky top-0 z-10 -mx-4 border-b border-divider bg-elevation-0 px-4 pb-2 pt-1">
      <HealthStrip health={$store.health} />
    </div>
  {:else if showCapabilityNotice}
    <div class="rounded border border-outline bg-elevation-1 px-3 py-2 text-sm text-secondary-text">
      No $SYS metrics are visible on this connection. Showing what this client
      can measure.
    </div>
  {/if}

  <!-- All data surfaces dim together while disconnected so the frozen values
       read as stale in the body, not only in the shell's banner. -->
  <div class="flex flex-col gap-4 transition-opacity" class:opacity-60={!$store.connected}>

  <!-- Traffic hero: msg/s in and out with the client-observed series. -->
  <HeroChart series={heroSeries} windowMinutes={$store.rangeMinutes} />

  <!-- Loudest topics (this client's subscriptions). -->
  <LoudestTopics loudest={$store.loudest} />

  <!-- Tile grid: gauges + custom/override tiles, then the always-last +. -->
  <div
    class="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3"
  >
    {#each visibleTiles as tile (tile.key)}
      <StatTile
        label={tile.label}
        value={tile.display}
        kind={tile.valueKind === "text" ? "text" : "number"}
        points={tile.samples}
        noData={tile.valueKind === "empty"}
        deltaPct={deltaPctFor(tile)}
        exact={exactFor(tile)}
        description={tile.tooltip}
        windowName={TILE_WINDOW}
      />
    {/each}

    <Tooltip text="Add metric tile" class="h-full">
      <button
        type="button"
        on:click={openAddEditor}
        aria-label="Add metric tile"
        class="flex h-full min-h-[76px] w-full flex-col items-center justify-center gap-1 rounded
          border border-dashed border-outline bg-elevation-1 text-secondary-text
          transition-colors hover:border-hovered hover:text-emphasis"
      >
        <Icon type="plus" size={22} />
      </button>
    </Tooltip>
  </div>

  <!-- Empty state: broker likely publishes no $SYS (or the sub was removed). -->
  {#if showEmptyState}
    <div
      class="flex flex-col gap-3 rounded border border-outline bg-elevation-1 p-4"
    >
      <span class="text-emphasis">No $SYS metrics seen yet</span>
      <p class="text-sm text-secondary-text">
        This broker may not publish <code>$SYS</code> health topics, or its
        <code>$SYS/#</code> subscription was removed. The observed-rate tiles
        above are measured by this client and keep working regardless. You can
        also pin any topic as a custom tile with the “+”.
      </p>
      {#if !hasSysSubscription}
        <div>
          <Button
            variant="secondary"
            iconType="plus"
            iconSize={16}
            disabled={addingSysSub}
            on:click={addSysSubscription}
          >
            {addingSysSub ? "Adding…" : "Add $SYS/# subscription"}
          </Button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Facts: broker/version, uptime, sessions, avg msg size. -->
  <FactsRow
    version={facts.version}
    uptimeSeconds={facts.uptimeSeconds}
    clientsConnected={facts.clientsConnected}
    clientsDisconnected={facts.clientsDisconnected}
    clientsExpired={facts.clientsExpired}
    avgMsgSize={facts.avgMsgSize}
  />

  </div>

  <!-- Collapsible raw $SYS browser (hidden until a first topic arrives: an
       empty expandable under the no-$SYS card reads as dead weight). -->
  {#if $store.latestByTopic.size > 0}
  <div class="flex flex-col rounded border border-outline bg-elevation-1">
    <button
      type="button"
      class="flex items-center gap-2 px-3 py-2 text-secondary-text transition-colors hover:text-emphasis"
      on:click={() => (rawExpanded = !rawExpanded)}
      aria-expanded={rawExpanded}
    >
      <span
        class="inline-flex transition-transform {rawExpanded ? 'rotate-90' : ''}"
      >
        <Icon type="right" size={16} />
      </span>
      <span>Raw $SYS topics</span>
      <span class="text-sm opacity-70">({$store.latestByTopic.size})</span>
    </button>

    {#if rawExpanded}
      <div class="flex flex-col gap-2 border-t border-outline p-3">
        <BaseInput
          name="raw-sys-filter"
          label="Filter topics"
          icon="search"
          bind:value={rawFilter}
        />

        {#if rawShown.length === 0}
          <span class="px-1 py-4 text-sm text-secondary-text">
            {rawEntries.length === 0
              ? "No $SYS topics received yet."
              : "No topics match the filter."}
          </span>
        {:else}
          <div class="max-h-[320px] overflow-auto">
            <table class="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr class="text-left text-secondary-text">
                  <th class="w-[42%] py-1 pr-3 font-normal">Topic</th>
                  <th class="w-[22%] py-1 pr-3 font-normal">Latest</th>
                  <th class="w-[13%] py-1 pr-3 text-right font-normal">Rate</th>
                  <th class="w-[15%] py-1 pr-3 font-normal">Age</th>
                  <th class="w-[8%] py-1 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {#each rawShown as row (row.topic)}
                  <tr class="border-t border-divider align-middle">
                    <td class="truncate py-1 pr-3 text-emphasis" title={row.topic}>
                      {row.topic}
                    </td>
                    <td
                      class="truncate py-1 pr-3 font-mono tabular-nums text-secondary-text"
                    >
                      {row.value}
                    </td>
                    <td
                      class="whitespace-nowrap py-1 pr-3 text-right font-mono tabular-nums text-secondary-text"
                    >
                      {row.rate !== null ? `${formatMetricValue(row.rate)}/s` : ""}
                    </td>
                    <td class="whitespace-nowrap py-1 pr-3 text-secondary-text">
                      {formatAge($nowTick, row.timeMs)}
                    </td>
                    <td class="py-1 text-right">
                      <IconButton
                        tooltipText="Pin as tile"
                        onClick={() => pinTopic(row.topic)}
                      >
                        <Icon type="plusSquare" size={16} />
                      </IconButton>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if rawHidden > 0}
            <span class="px-1 text-sm text-secondary-text opacity-70">
              {rawHidden} more hidden. Narrow the filter to see them.
            </span>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
  {/if}
</div>

<MetricMappingEditor
  {connectionId}
  {store}
  isOpen={editorOpen}
  prefill={editorPrefill}
/>
