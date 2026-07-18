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
  // 0 = all history; otherwise show only the last N seconds.
  export let windowSeconds = 0;

  let container: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  // Drives the sliding time-window: when windowSeconds>0 the x-axis min/max are
  // anchored to Date.now(), so without fresh data the view would freeze. Tick
  // re-renders ~1s so the window keeps sliding even when no messages arrive.
  let windowTick: ReturnType<typeof setInterval> | null = null;

  // force bypasses the paused guard: a theme flip must restyle the axis and
  // tooltip chrome immediately, even while the chart is paused.
  const render = (force = false) => {
    if (!chart || (paused && !force)) return;
    chart.setOption(
      buildChartOption({
        history: $selectedTopicStore.history,
        series: $chartSeriesStore,
        windowSeconds,
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
  $: $selectedTopicStore.history,
    $chartSeriesStore,
    style,
    showPoints,
    windowSeconds,
    paused,
    render();

  $: $theme, render(true);

  // Keep the ticker running only while a finite, unpaused window is shown.
  const syncWindowTick = () => {
    const wantTick = windowSeconds > 0 && !paused;
    if (wantTick && windowTick === null) {
      windowTick = setInterval(render, 1000);
    } else if (!wantTick && windowTick !== null) {
      clearInterval(windowTick);
      windowTick = null;
    }
  };
  $: windowSeconds, paused, syncWindowTick();

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
