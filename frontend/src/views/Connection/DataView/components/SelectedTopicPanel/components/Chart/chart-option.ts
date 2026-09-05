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
  theme?: "dark" | "light";
}

// echarts paints to canvas, so CSS variables can't be used here; each theme
// gets its own literal palette, matching the tones in src/style.css.
const CHROME_COLORS = {
  dark: {
    axis: "#525252",
    label: "#aeaeae",
    splitLine: "#2e2e2e",
    tooltipBackground: "#1f1e1e",
    tooltipBorder: "#525252",
    tooltipText: "#eee",
  },
  light: {
    axis: "#b8b8c0",
    label: "#5f5f69",
    splitLine: "#e4e4e8",
    tooltipBackground: "#ffffff",
    tooltipBorder: "#c8c8ce",
    tooltipText: "#26262b",
  },
} as const;

interface SeriesPoints {
  points: [number, number][];
  // Value extent of the points strictly inside the window (excludes the
  // leading point below); Infinity/-Infinity when there are none.
  windowLo: number;
  windowHi: number;
}

// Builds one series' plotted points. When `min` is set (a finite window),
// points before it are dropped except the single most recent one, which is
// kept so the line still draws into the left edge instead of leaving a gap.
// That leading point is excluded from windowLo/windowHi so an old,
// far-outside value can't stretch the Y-axis back toward the bug this is
// fixing (see buildChartOption).
const seriesPoints = (
  history: MqttHistoryMessage[],
  path: string,
  min: number | null
): SeriesPoints => {
  const points: [number, number][] = [];
  let leading: [number, number] | null = null;
  let windowLo = Infinity;
  let windowHi = -Infinity;
  for (const m of history) {
    // stub entries haven't had their payload fetched yet
    if (m.payload === null) continue;
    const value = valueAtPath(m.payload, path);
    if (value === null) continue;
    if (min !== null && m.timeMs < min) {
      if (leading === null || m.timeMs > leading[0]) leading = [m.timeMs, value];
      continue;
    }
    points.push([m.timeMs, value]);
    if (value < windowLo) windowLo = value;
    if (value > windowHi) windowHi = value;
  }
  if (leading !== null) points.unshift(leading);
  return { points, windowLo, windowHi };
};

export const buildChartOption = ({
  history,
  series,
  windowSeconds,
  showPoints,
  style,
  now,
  theme = "dark",
}: ChartOptionParams): EChartsOption => {
  const visible = series.filter((s) => s.visible);
  const chrome = CHROME_COLORS[theme];
  const axisColor = chrome.axis;
  const labelColor = chrome.label;
  // Always emit min/max: echarts merges the xAxis on setOption, so when
  // switching back to "All history" (windowSeconds 0) we must explicitly clear
  // the previous window's bounds with null, else they persist and the axis
  // stays clamped. null lets echarts auto-fit to the data extent.
  let xAxisExtra: Record<string, unknown> = { min: null, max: null };
  let windowMin: number | null = null;
  if (windowSeconds > 0) {
    windowMin = now - windowSeconds * 1000;
    xAxisExtra = { min: windowMin, max: now };
  }

  let windowLo = Infinity;
  let windowHi = -Infinity;
  const seriesOption = visible.map((s) => {
    const { points, windowLo: lo, windowHi: hi } = seriesPoints(history, s.path, windowMin);
    if (lo < windowLo) windowLo = lo;
    if (hi > windowHi) windowHi = hi;
    return {
      // id keys the series by its full payload path so replaceMerge and the
      // tooltip stay stable even when two paths share a last segment (and thus
      // the same display label, e.g. a.temp / b.temp -> "temp").
      id: s.path,
      name: s.label,
      type: "line" as const,
      // All-history renders the full retained extent, so downsample with
      // LTTB to keep redraws cheap on high-volume topics. echarts only
      // applies sampling when points outnumber pixels, so sparse series
      // render exactly as before.
      sampling: "lttb" as const,
      showSymbol: showPoints,
      symbolSize: 5,
      smooth: false,
      lineStyle: { color: s.color, width: 2 },
      itemStyle: { color: s.color },
      areaStyle: style === "area" ? { color: s.color, opacity: 0.12 } : undefined,
      data: points,
    };
  });

  // yAxis.scale:true autoscales from each series' full `data` array. When
  // windowed, `data` deliberately still carries one pre-window point per
  // series for line continuity (see seriesPoints), so scale:true would let
  // that leading value stretch the axis back toward the bug this is fixing.
  // Range explicitly over only the in-window values instead; fall back to
  // scale:true when there's nothing in-window to range over, or the window
  // is off (windowMin null), where `data` already holds the full, correct
  // extent.
  // Always emit min/max alongside scale (same reasoning as xAxisExtra above):
  // echarts deep-merges yAxis on setOption, so an absent bound here would
  // leave a previous windowed render's numeric min/max clamped in place.
  let yAxisExtra: Record<string, unknown> = { scale: true, min: null, max: null };
  if (windowMin !== null && windowLo <= windowHi) {
    // Explicit min/max bypass echarts' own padding, so add back roughly the
    // same ~10% headroom scale:true would have given a non-flat range.
    const pad = (windowHi - windowLo) * 0.1 || Math.max(Math.abs(windowHi), 1) * 0.1;
    yAxisExtra = { min: windowLo - pad, max: windowHi + pad };
  }

  return {
    animation: false,
    grid: { left: 48, right: 14, top: 14, bottom: 26 },
    tooltip: {
      trigger: "axis",
      backgroundColor: chrome.tooltipBackground,
      borderColor: chrome.tooltipBorder,
      textStyle: { color: chrome.tooltipText, fontSize: 12 },
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
      axisLine: { show: false },
      axisLabel: { color: labelColor, fontSize: 10 },
      splitLine: { lineStyle: { color: chrome.splitLine } },
      ...yAxisExtra,
    },
    series: seriesOption,
  };
};
