<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as echarts from "echarts";
  import type {
    MqttHistoryMessage,
    SelectedTopicStore,
  } from "../../../../stores/selected-topic-store";
  import type { ChartSeriesStore } from "./chart-series-store";
  import { valueAtPath } from "./payload-fields";

  export let selectedTopicStore: SelectedTopicStore;
  export let chartSeriesStore: ChartSeriesStore;
  export let paused = false;
  export let style: "line" | "area" = "line";
  export let showPoints = true;
  // 0 = all history; otherwise show only the last N minutes.
  export let windowMinutes = 0;

  let container: HTMLDivElement;
  let chart: echarts.ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;
  // Drives the sliding time-window: when windowMinutes>0 the x-axis min/max are
  // anchored to Date.now(), so without fresh data the view would freeze. Tick
  // re-renders ~1s so the window keeps sliding even when no messages arrive.
  let windowTick: ReturnType<typeof setInterval> | null = null;

  const seriesData = (history: MqttHistoryMessage[], path: string) => {
    const points: [number, number][] = [];
    for (const m of history) {
      const value = valueAtPath(m.payload, path);
      if (value !== null) points.push([m.timeMs, value]);
    }
    return points;
  };

  const buildOption = (
    history: MqttHistoryMessage[],
    series: { path: string; label: string; color: string; visible: boolean }[]
  ): echarts.EChartsOption => {
    const visible = series.filter((s) => s.visible);
    const axisColor = "#525252";
    const labelColor = "#aeaeae";
    // Always emit min/max: echarts merges the xAxis on setOption, so when
    // switching back to "All history" (windowMinutes 0) we must explicitly
    // clear the previous window's bounds with null, else they persist and the
    // axis stays clamped. null lets echarts auto-fit to the data extent.
    let xAxisExtra: Record<string, unknown> = { min: null, max: null };
    if (windowMinutes > 0) {
      const now = Date.now();
      xAxisExtra = { min: now - windowMinutes * 60_000, max: now };
    }
    return {
      animation: false,
      grid: { left: 48, right: 14, top: 14, bottom: 26 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#1f1e1e",
        borderColor: "#525252",
        textStyle: { color: "#eee", fontSize: 12 },
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: axisColor } },
        axisLabel: { color: labelColor, fontSize: 10, hideOverlap: true },
        splitLine: { show: false },
        ...xAxisExtra,
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLine: { show: false },
        axisLabel: { color: labelColor, fontSize: 10 },
        splitLine: { lineStyle: { color: "#2e2e2e" } },
      },
      series: visible.map((s) => ({
        // id keys the series by its full payload path so replaceMerge and the
        // tooltip stay stable even when two paths share a last segment (and
        // thus the same display label, e.g. a.temp / b.temp -> "temp").
        id: s.path,
        name: s.label,
        type: "line",
        showSymbol: showPoints,
        symbolSize: 5,
        smooth: false,
        lineStyle: { color: s.color, width: 2 },
        itemStyle: { color: s.color },
        areaStyle: style === "area" ? { color: s.color, opacity: 0.12 } : undefined,
        data: seriesData(history, s.path),
      })),
    };
  };

  const render = () => {
    if (!chart || paused) return;
    chart.setOption(
      buildOption($selectedTopicStore.history, $chartSeriesStore),
      { replaceMerge: ["series"] }
    );
  };

  // Re-render on new history, series add/remove/visibility, or option change,
  // unless paused.
  $: $selectedTopicStore.history,
    $chartSeriesStore,
    style,
    showPoints,
    windowMinutes,
    paused,
    render();

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
