import { describe, it, expect } from "vitest";
import { buildChartOption, type ChartOptionParams } from "./chart-option";
import type { ChartSeries } from "./chart-series-store";
import type { MqttHistoryMessage } from "../../../../stores/selected-topic-store";

const NOW = 1_700_000_000_000;

const msg = (timeMs: number, payload: string): MqttHistoryMessage =>
  ({ timeMs, payload } as MqttHistoryMessage);

const series: ChartSeries[] = [
  { path: "temp", label: "temp", color: "#f5a623", visible: true },
];

const params = (over: Partial<ChartOptionParams> = {}): ChartOptionParams => ({
  history: [msg(NOW - 1000, '{"temp":21}'), msg(NOW, '{"temp":22}')],
  series,
  windowMinutes: 0,
  showPoints: true,
  style: "line",
  now: NOW,
  ...over,
});

// Access xAxis as the single-object form buildChartOption always produces.
const xAxis = (p: ChartOptionParams) =>
  buildChartOption(p).xAxis as { min?: unknown; max?: unknown };

describe("buildChartOption xAxis bounds", () => {
  it("anchors min/max to a sliding window when windowMinutes > 0", () => {
    const ax = xAxis(params({ windowMinutes: 5 }));
    expect(ax.min).toBe(NOW - 5 * 60_000);
    expect(ax.max).toBe(NOW);
  });

  it("emits null min/max for All history (windowMinutes 0)", () => {
    const ax = xAxis(params({ windowMinutes: 0 }));
    // Regression #95: min/max must be present-and-null, not absent. echarts
    // merges the xAxis on setOption, so an absent bound leaves the previous
    // window's clamp in place and "All history" appears to do nothing.
    expect(ax).toHaveProperty("min", null);
    expect(ax).toHaveProperty("max", null);
  });

  it("clears the previous window's bounds when switching finite -> All history", () => {
    // Simulate the bug's repro: build with a finite window, then all-history.
    xAxis(params({ windowMinutes: 15 }));
    const cleared = xAxis(params({ windowMinutes: 0 }));
    expect(cleared.min).toBeNull();
    expect(cleared.max).toBeNull();
  });
});

describe("buildChartOption series", () => {
  it("plots only visible series, keyed by path, with points from the payload", () => {
    const opt = buildChartOption(
      params({
        series: [
          { path: "temp", label: "temp", color: "#f5a623", visible: true },
          { path: "hum", label: "hum", color: "#7788fc", visible: false },
        ],
      })
    );
    const s = opt.series as { id: string; data: [number, number][] }[];
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe("temp");
    expect(s[0].data).toEqual([
      [NOW - 1000, 21],
      [NOW, 22],
    ]);
  });
});
