// Pure builder for the ECharts option object used by the broker-status traffic
// hero chart. Kept out of HeroChart.svelte so the axis/series math is
// unit-testable without mounting echarts. Deliberately NOT built on
// buildChartOption (that one is coupled to message history + payload paths);
// the hero plots pre-aggregated msgs/s series with gap markers instead.
import type { EChartsOption } from "echarts";
import { CHROME_COLORS } from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/chart-option";
import { CHART_PALETTE } from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/chart-series-store";

// A single sample. `v` is null for a gap marker (e.g. across a disconnect),
// rendered as a line break rather than a bridge (connectNulls: false).
export interface HeroSeriesPoint {
  t: number;
  v: number | null;
}

export interface HeroSeries {
  // Stable id ("in" / "out" / "observed") so replaceMerge keeps series identity
  // across 1 Hz redraws.
  id: string;
  label: string;
  points: HeroSeriesPoint[];
  // Dashed + muted styling: the client-observed series when broker series are
  // also present. A lone non-dashed series is promoted to solid primary.
  dashed: boolean;
  // Slightly heavier line for the series the reader should track first.
  emphasis?: boolean;
  // Legend tooltip copy. Consumed by HeroChart's custom HTML legend, not by the
  // ECharts option; declared here so both share one series shape.
  tooltip?: string;
}

export interface HeroChartOptionParams {
  series: HeroSeries[];
  // The visible span in minutes (1 / 5 / 15); always > 0 for the hero.
  windowMinutes: number;
  // Current time in ms; injected so the sliding window is deterministic in
  // tests and stories.
  now: number;
  theme?: "dark" | "light";
}

// Primary line colour (matches the design-system `primary` token) used when a
// single non-dashed series is shown alone.
const PRIMARY = CHART_PALETTE[1];

// Colour for a series given its position and the total count. A lone,
// non-dashed series (the observed-only case) is promoted to primary; otherwise
// colours come from the shared chart palette in array order.
export const heroSeriesColor = (
  series: HeroSeries,
  index: number,
  total: number
): string => {
  if (total === 1 && !series.dashed) return PRIMARY;
  return CHART_PALETTE[index % CHART_PALETTE.length];
};

export const buildHeroChartOption = ({
  series,
  windowMinutes,
  now,
  theme = "dark",
}: HeroChartOptionParams): EChartsOption => {
  const chrome = CHROME_COLORS[theme];
  const total = series.length;
  return {
    animation: false,
    grid: { left: 44, right: 14, top: 10, bottom: 22 },
    // No ECharts legend: a custom HTML legend row above the canvas carries the
    // live values without 1 Hz reflow jitter (see HeroChart.svelte).
    legend: { show: false },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: chrome.axis } },
      backgroundColor: chrome.tooltipBackground,
      borderColor: chrome.tooltipBorder,
      textStyle: { color: chrome.tooltipText, fontSize: 12 },
    },
    xAxis: {
      type: "time",
      // Always anchored to the sliding window: echarts merges the xAxis on
      // setOption, so the min/max must be emitted every render or the window
      // stops sliding when no fresh data arrives.
      min: now - windowMinutes * 60_000,
      max: now,
      axisLine: { lineStyle: { color: chrome.axis } },
      axisLabel: { color: chrome.label, fontSize: 10, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "msgs/s",
      nameTextStyle: { color: chrome.label, fontSize: 10, align: "left" },
      // Rates are non-negative; a 0 baseline keeps the visual honest.
      min: 0,
      axisLine: { show: false },
      axisLabel: { color: chrome.label, fontSize: 10 },
      splitLine: { lineStyle: { color: chrome.splitLine } },
    },
    series: series.map((s, index) => {
      const color = heroSeriesColor(s, index, total);
      return {
        id: s.id,
        name: s.label,
        type: "line",
        showSymbol: false,
        smooth: false,
        // Break the line across gap markers instead of bridging them.
        connectNulls: false,
        lineStyle: {
          color,
          width: s.emphasis ? 2.5 : 2,
          type: s.dashed ? "dashed" : "solid",
          opacity: s.dashed ? 0.55 : 1,
        },
        itemStyle: { color },
        data: s.points.map((p) => [p.t, p.v] as [number, number | null]),
      };
    }),
  };
};
