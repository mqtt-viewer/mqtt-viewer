<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as echarts from "echarts";
  import theme from "@/stores/theme";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import {
    buildHeroChartOption,
    heroSeriesColor,
    type HeroSeries,
  } from "./hero-chart-option";

  // Pre-aggregated msgs/s series ("in" / "out" / "observed"). Rendered from
  // props alone so the component works in a story without a live store.
  export let series: HeroSeries[] = [];
  // Visible span in minutes (1 / 5 / 15); drives the sliding x-axis window.
  export let windowMinutes = 5;
  export let height = 160;

  let container: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  // The x-axis min/max are anchored to Date.now(), so without fresh data the
  // view would freeze. A 1 Hz tick re-renders so the window keeps sliding even
  // when no messages arrive (matches TopicChart).
  let windowTick: ReturnType<typeof setInterval> | null = null;

  const render = () => {
    if (!chart) return;
    chart.setOption(
      buildHeroChartOption({
        series,
        windowMinutes,
        now: Date.now(),
        theme: $theme,
      }),
      { replaceMerge: ["series"] }
    );
  };

  // Re-render on new series or a window change.
  $: series, windowMinutes, render();
  // A theme flip must restyle the axis/tooltip chrome immediately.
  $: $theme, render();

  // The last observed (non-null) value per series, for the live legend. Kept in
  // a fixed-min-width slot so the 1 Hz update never reflows the row.
  const currentValue = (s: HeroSeries): string => {
    for (let i = s.points.length - 1; i >= 0; i -= 1) {
      const v = s.points[i].v;
      if (v !== null) return formatRate(v);
    }
    return "n/a";
  };

  const formatRate = (v: number): string => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    if (v >= 100) return `${Math.round(v)}`;
    return v.toFixed(1);
  };

  onMount(() => {
    chart = echarts.init(container, undefined, { renderer: "canvas" });
    render();
    resizeObserver = new ResizeObserver(() => chart?.resize());
    resizeObserver.observe(container);
    windowTick = setInterval(render, 1000);
  });

  onDestroy(() => {
    if (windowTick !== null) clearInterval(windowTick);
    resizeObserver?.disconnect();
    chart?.dispose();
    chart = null;
  });
</script>

<div class="flex flex-col gap-1">
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
    {#each series as s, i (s.id)}
      <Tooltip text={s.tooltip ?? ""} placement="top">
        <div class="flex items-center gap-1.5">
          <span
            class="size-2.5 min-w-2.5 rounded-[2px]"
            style:background-color={heroSeriesColor(s, i, series.length)}
          ></span>
          <span class="text-sm text-secondary-text">{s.label}</span>
          <span
            class="min-w-[3.5rem] text-right text-sm font-medium tabular-nums text-emphasis"
            >{currentValue(s)}</span
          >
        </div>
      </Tooltip>
    {/each}
  </div>
  <div bind:this={container} class="w-full" style:height={`${height}px`}></div>
</div>
