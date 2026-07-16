<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as echarts from "echarts";
  import theme from "@/stores/theme";
  import type { SelectedTopicStore } from "../../../../stores/selected-topic-store";
  import type { ChartSeriesStore } from "./chart-series-store";
  import { buildChartOption } from "./chart-option";

  export let selectedTopicStore: SelectedTopicStore;
  export let chartSeriesStore: ChartSeriesStore;
  export let paused = false;
  export let style: "line" | "area" = "line";
  export let showPoints = true;
  // 0 = all history; otherwise show only the last N minutes.
  export let windowMinutes = 0;
  // True once the Chart tab is genuinely the visible tab. This component is
  // always mounted (Tabs.svelte renders every panel, hiding inactive ones),
  // so this is the actual gate on fetching every payload. Defaults to true
  // so callers that don't pass it (e.g. existing stories/fixtures) keep their
  // previous always-render behaviour.
  export let isActive = true;

  let container: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  // Drives the sliding time-window: when windowMinutes>0 the x-axis min/max are
  // anchored to Date.now(), so without fresh data the view would freeze. Tick
  // re-renders ~1s so the window keeps sliding even when no messages arrive.
  let windowTick: ReturnType<typeof setInterval> | null = null;

  // The chart needs every message's payload to plot a series across time,
  // unlike the rest of the panel which only ever needs one or two messages'
  // payloads. `history` itself only carries stubs (see selected-topic-store),
  // so this reads the store's separate full-payload chartHistory cache
  // instead, populated on demand by ensureChartHistory below. Falls back to
  // `history` when chartHistory hasn't been requested yet. This also keeps
  // Storybook fixtures (which set `history` directly with payloads already
  // present, and never populate chartHistory) working unchanged.
  $: chartData = $selectedTopicStore.chartHistory ?? $selectedTopicStore.history;

  // force bypasses the paused guard: a theme flip must restyle the axis and
  // tooltip chrome immediately, even while the chart is paused.
  const render = (force = false) => {
    if (!chart || (paused && !force)) return;
    chart.setOption(
      buildChartOption({
        history: chartData,
        series: $chartSeriesStore,
        windowMinutes,
        showPoints,
        style,
        now: Date.now(),
        theme: $theme,
      }),
      { replaceMerge: ["series"] }
    );
  };

  // Re-render on new history, series add/remove/visibility, or option change,
  // unless paused.
  $: chartData,
    $chartSeriesStore,
    style,
    showPoints,
    windowMinutes,
    paused,
    render();

  // This component is always mounted, even behind an inactive tab (Tabs.svelte
  // renders every panel), so it must not fetch every payload just because it
  // exists. Only once the Chart tab is genuinely visible does the full
  // window actually get read. ensureChartHistory itself no-ops once loaded
  // or already loading, so this is cheap to re-evaluate.
  $: if (isActive) {
    selectedTopicStore.ensureChartHistory();
  }

  $: $theme, render(true);

  // Keep the ticker running only while a finite, unpaused window is shown.
  const syncWindowTick = () => {
    const wantTick = windowMinutes > 0 && !paused;
    if (wantTick && windowTick === null) {
      windowTick = setInterval(render, 1000);
    } else if (!wantTick && windowTick !== null) {
      clearInterval(windowTick);
      windowTick = null;
    }
  };
  $: windowMinutes, paused, syncWindowTick();

  onMount(() => {
    chart = echarts.init(container, undefined, { renderer: "canvas" });
    render();
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(container);
  });

  onDestroy(() => {
    if (windowTick !== null) clearInterval(windowTick);
    resizeObserver?.disconnect();
    chart?.dispose();
    chart = null;
  });
</script>

<div class="relative size-full">
  <div bind:this={container} class="size-full"></div>
  {#if $chartSeriesStore.filter((s) => s.visible).length === 0}
    <div
      class="absolute inset-0 flex items-center justify-center text-secondary-text text-base pointer-events-none"
    >
      Select numeric values from the payload to chart
    </div>
  {/if}
</div>
