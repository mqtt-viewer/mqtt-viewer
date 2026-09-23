<script lang="ts">
  // Body of the detached Broker Status window. v2 layout, top to bottom:
  // sticky health strip (chips plus the broker facts, or a capability notice
  // when no $SYS card is showing), the traffic hero chart, the loudest-topics
  // table, the gauges grid (with an always-last "+"), and the collapsible raw
  // $SYS browser. The v1 no-$SYS empty state + add-subscription CTA is kept.
  // The window shell owns the store's lifecycle and the header (pill + range
  // selector); this view only reads the store and drives the mapping editor.
  import { onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import StatTile from "../StatTile/StatTile.svelte";
  import MetricMappingEditor from "../MetricMappingEditor/MetricMappingEditor.svelte";
  import HealthStrip from "../HealthStrip/HealthStrip.svelte";
  import HeroChart from "../HeroChart/HeroChart.svelte";
  import LoudestTopics from "../LoudestTopics/LoudestTopics.svelte";
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
  import {
    formatMetricValue,
    hasBrokerFacts,
    type BrokerFacts,
  } from "../../sys-metrics";
  import { nowTick, formatAge, createRawRateTracker } from "./raw-browser";

  export let store: BrokerStatusStore;
  export let connectionId: number;

  const SYS_TOPIC = "$SYS/#";
  const EMPTY_GRACE_MS = 10_000;
  const MAX_RAW_ROWS = 500;
  // Fallback window name for a tile with too few samples to measure a span.
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

  // Broker facts for the strip, read straight off the metric snapshots. Each
  // one is null until its metric has a value, so the segment grows into the bar
  // rather than reserving space for numbers that may never come.
  $: facts = {
    version: $store.metricByKey.get("version")?.text ?? null,
    uptimeSeconds: $store.metricByKey.get("uptime")?.value ?? null,
    clientsConnected: $store.metricByKey.get("clients_connected")?.value ?? null,
    clientsDisconnected:
      $store.metricByKey.get("clients_disconnected")?.value ?? null,
    clientsExpired: $store.metricByKey.get("clients_expired")?.value ?? null,
    avgMsgSize: $store.metricByKey.get("avg_msg_size")?.value ?? null,
  } satisfies BrokerFacts;

  // Health strip vs capability notice (deduplicated against the v1 empty card):
  // the strip shows once any chip has data, or once the broker has published a
  // fact (a broker with $SYS but no health signals still has an identity worth
  // printing). The notice only stands in when no $SYS has EVER been seen (so a
  // healthy broker's chip warm-up cannot flash a false "no $SYS" claim) and the
  // empty card is not already showing. It also needs the connection to have
  // been up at least once: claiming a broker publishes no $SYS before ever
  // reaching it is a guess, not a finding.
  $: hasHealth = $store.health.some((c) => c.render);
  $: showStrip = hasHealth || hasBrokerFacts(facts);
  $: showCapabilityNotice =
    graceElapsed &&
    !showStrip &&
    !showEmptyState &&
    !$store.sysEverSeen &&
    $store.everConnected;

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
    // Past 15 m the store serves minute rollups stitched to the live tail; the
    // raw second-grain buffers only reach back 900 samples.
    const long = state.longSeries;
    const inS = long?.get("msg_rate_in") ?? m.get("msg_rate_in")?.samples ?? [];
    const outS =
      long?.get("msg_rate_out") ?? m.get("msg_rate_out")?.samples ?? [];
    const observed = long?.get("observed") ?? state.observedSeries ?? [];
    const hasBroker = inS.length > 0 || outS.length > 0;
    // A minute rollup's points sit a minute apart by design, so the gap
    // threshold has to clear that or every point would draw as a break.
    const minGap = long ? 3 * 60_000 : 0;
    const brokerGap = Math.max(minGap, 30_000, 3 * state.learnedIntervalMs);
    const observedGap = Math.max(minGap, OBSERVED_GAP_MS);
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
        observedGap
      ),
      dashed: hasBroker,
      emphasis: false,
      tooltip: "this second, as received by this client",
    });
    return series;
  };

  $: heroSeries = buildHeroSeries($store);

  // --- Gauge tiles: delta arrow + hover-panel inputs -------------------------
  // Percentage change across the visible sparkline window (last vs first). A
  // zero baseline makes a percentage meaningless, so growth from zero returns
  // Infinity, which the tile prints as its ">999%" ceiling.
  //
  // Samples from before the store's trend floor are skipped: after a reconnect
  // a delta measured against the pre-outage baseline is an artefact of the gap,
  // not a change in the broker.
  const deltaPctFor = (
    tile: BrokerTileView,
    floorMs: number
  ): number | undefined => {
    // Custom tiles with a unit can be interval scales (temperature and the
    // like) where percent change is meaningless; skip the delta for those.
    if (tile.key.startsWith("custom:") && tile.unit) return undefined;
    const s = tile.samples;
    if (!s || s.length < 2) return undefined;
    // Samples are time-ordered, so a forward scan finds the window start.
    let i = 0;
    while (i < s.length && s[i].t < floorMs) i++;
    if (s.length - i < 2) return undefined;
    const first = s[i].v;
    const last = s[s.length - 1].v;
    if (first === 0) {
      return last === 0 ? undefined : Number.POSITIVE_INFINITY;
    }
    return ((last - first) / Math.abs(first)) * 100;
  };

  // The sparkline buffer is capped by COUNT, not by time: at mosquitto's ~10 s
  // $SYS cadence 900 samples span 2.5 h, not the 15 m the observed (1 Hz) tiles
  // span. Name the window the samples actually cover.
  const formatSpan = (ms: number): string => {
    const minutes = ms / 60_000;
    if (minutes < 1.5) return `${Math.max(1, Math.round(ms / 1000))}s`;
    if (minutes < 90) return `${Math.round(minutes)}m`;
    const hours = minutes / 60;
    return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  };

  const windowNameFor = (tile: BrokerTileView): string => {
    const s = tile.samples;
    if (!s || s.length < 2) return TILE_WINDOW;
    return formatSpan(s[s.length - 1].t - s[0].t);
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
  <!-- Health strip (sticky) or capability notice. The strip is the window's
       second bar, so it bleeds out of the body's p-4 on all four sides
       (-mx-4/-mt-4) to sit flush under the header, and pays the inset back as
       its own px-4: its content edge lines up with the body's. Vertical
       padding is one value (py-3), so pinning at the top of the scroll
       container looks the same as it does at rest. The gap-4 below it is the
       only separation from the hero, which keeps the header border, the strip
       border and the body one line each. -->
  {#if showStrip}
    <div class="sticky top-0 z-10 -mx-4 -mt-4 border-b border-outline bg-elevation-0 px-4 py-3">
      <HealthStrip health={$store.health} {facts} />
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

  <!-- Loudest topics, measured across this client's own subscriptions. -->
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
        deltaPct={deltaPctFor(tile, $store.trendFloorMs)}
        exact={exactFor(tile)}
        description={tile.tooltip}
        windowName={windowNameFor(tile)}
      />
    {/each}

    <Tooltip text="Add metric tile" class="h-full" focusable>
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

  <!-- Collapsible raw $SYS browser (hidden until a first topic arrives: an
       empty expandable under the no-$SYS card reads as dead weight). Inside
       the dim wrapper: its frozen values must fade with the rest. The health
       strip stays outside deliberately (it is sticky and needs an opaque,
       full-strength treatment; chips carry their own stale greying). -->
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
                  <tr class="border-t border-outline align-middle">
                    <td class="truncate py-1 pr-3 text-emphasis" title={row.topic}>
                      {row.topic}
                    </td>
                    <td
                      class="truncate py-1 pr-3 font-mono tabular-nums text-secondary-text"
                      title={row.value}
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
</div>

<MetricMappingEditor
  {connectionId}
  {store}
  isOpen={editorOpen}
  prefill={editorPrefill}
/>
