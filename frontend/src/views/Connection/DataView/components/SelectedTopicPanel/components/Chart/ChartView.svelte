<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import chartWindows from "@/stores/chart-windows";
  import type { SelectedTopicStore } from "../../../../stores/selected-topic-store";
  import type { ChartSeriesStore } from "./chart-series-store";
  import TopicChart from "./TopicChart.svelte";
  import SeriesLegend from "./SeriesLegend.svelte";
  import ChartOptions from "./ChartOptions.svelte";

  export let selectedTopicStore: SelectedTopicStore;
  export let chartSeriesStore: ChartSeriesStore;
  export let topic: string;
  export let onAddFromPayload: (() => void) | null = null;
  // Pop-out control (shown in the docked panel, hidden in a popped-out window).
  export let onPopOut: (() => void) | null = null;

  let paused = false;
  let style: "line" | "area" = "line";
  let showPoints = true;
  let windowSeconds = 0;

  // ChartView is the shared host for both the docked chart and the pop-out
  // (ChartWindow.svelte renders this component and owns no window state of
  // its own). The pop-out never runs stores/initialization.ts, so the
  // per-connection window store is loaded on demand here via its idempotent
  // init(). The chart subtree (ChartOptions + TopicChart) is held back until
  // the persisted value has been seeded, so ChartOptions/its custom field
  // never mount with a default 0 that would then seed asynchronously.
  let ready = false;

  onMount(async () => {
    try {
      await chartWindows.init();
      windowSeconds = chartWindows.get(get(selectedTopicStore).connectionId);
    } catch (e) {
      // A failed load must not blank the chart: fall back to All history
      // (windowSeconds stays 0) and render regardless.
      console.error("Failed to load chart window preference", e);
    } finally {
      ready = true;
    }
  });

  // Fires only from a genuine user action inside ChartOptions (a preset
  // click or a custom-field edit) -- never for the initial seed above. There
  // is deliberately no reactive statement mirroring windowSeconds into a
  // write here: that would also fire on the seed assignment and clobber a
  // saved value with 0, and could loop.
  const onWindowSecondsChange = (seconds: number) => {
    chartWindows.set(get(selectedTopicStore).connectionId, seconds);
  };
</script>

<div class="flex flex-col size-full min-h-0">
  <div class="flex items-center gap-1 pb-1">
    <Tooltip text={paused ? "Resume live updates" : "Pause live updates"}>
      <IconButton onClick={() => (paused = !paused)}>
        <span class={paused ? "text-primary" : ""}>
          <Icon type={paused ? "connect" : "pause"} size={16} />
        </span>
      </IconButton>
    </Tooltip>
    {#if ready}
      <ChartOptions
        bind:style
        bind:showPoints
        bind:windowSeconds
        {onWindowSecondsChange}
      />
    {/if}
    {#if onPopOut}
      <Tooltip text="Open in a new window">
        <IconButton onClick={onPopOut}>
          <Icon type="popOut" size={15} />
        </IconButton>
      </Tooltip>
    {/if}
    <div class="grow"></div>
    {#if paused}
      <span class="text-sm text-primary">Paused</span>
    {/if}
  </div>

  <div
    class="grow min-h-[160px] rounded-sm border border-outline bg-elevation-0 p-1"
  >
    {#if ready}
      <TopicChart
        {selectedTopicStore}
        {chartSeriesStore}
        {paused}
        {style}
        {showPoints}
        {windowSeconds}
      />
    {/if}
  </div>

  <div class="mt-3 overflow-y-auto">
    <SeriesLegend {chartSeriesStore} {topic} {onAddFromPayload} />
  </div>
</div>
