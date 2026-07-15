// Pure builder for the ECharts option object used by TopicChart. Kept out of
// the .svelte component so the axis/series math is unit-testable without
// mounting echarts.
import type { EChartsOption } from "echarts";
import type { MqttHistoryMessage } from "../../../../stores/selected-topic-store";
import type { ChartSeries } from "./chart-series-store";
import { valueAtPath } from "./payload-fields";

export interface ChartOptionParams {
  history: MqttHistoryMessage[];
  series: ChartSeries[];
  // 0 = all history; otherwise show only the last N seconds (the canonical
  // unit for chart windows since the custom-interval options).
  windowSeconds: number;
  showPoints: boolean;
  style: "line" | "area";
  // Current time in ms; injected so the sliding window is deterministic in tests.
  now: number;
}

const seriesData = (
  history: MqttHistoryMessage[],
  path: string
): [number, number][] => {
  const points: [number, number][] = [];
  for (const m of history) {
    const value = valueAtPath(m.payload, path);
    if (value !== null) points.push([m.timeMs, value]);
  }
  return points;
};

export const buildChartOption = ({
  history,
  series,
  windowSeconds,
  showPoints,
  style,
  now,
}: ChartOptionParams): EChartsOption => {
  const visible = series.filter((s) => s.visible);
  const axisColor = "#525252";
  const labelColor = "#aeaeae";
  // Always emit min/max: echarts merges the xAxis on setOption, so when
  // switching back to "All history" (windowSeconds 0) we must explicitly clear
  // the previous window's bounds with null, else they persist and the axis
  // stays clamped. null lets echarts auto-fit to the data extent.
  let xAxisExtra: Record<string, unknown> = { min: null, max: null };
  if (windowSeconds > 0) {
    xAxisExtra = { min: now - windowSeconds * 1000, max: now };
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
      // tooltip stay stable even when two paths share a last segment (and thus
      // the same display label, e.g. a.temp / b.temp -> "temp").
      id: s.path,
      name: s.label,
      type: "line",
      // All-history renders the full retained extent, so downsample with
      // LTTB to keep redraws cheap on high-volume topics. echarts only
      // applies sampling when points outnumber pixels, so sparse series
      // render exactly as before.
      sampling: "lttb",
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
