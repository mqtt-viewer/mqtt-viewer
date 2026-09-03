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
  windowSeconds: 0,
  showPoints: true,
  style: "line",
  now: NOW,
  ...over,
});

// Access xAxis as the single-object form buildChartOption always produces.
const xAxis = (p: ChartOptionParams) =>
  buildChartOption(p).xAxis as { min?: unknown; max?: unknown };

describe("buildChartOption xAxis bounds", () => {
  it("anchors min/max to a sliding window when windowSeconds > 0", () => {
    const ax = xAxis(params({ windowSeconds: 300 }));
    expect(ax.min).toBe(NOW - 300 * 1000);
    expect(ax.max).toBe(NOW);
  });

  it("emits null min/max for All history (windowSeconds 0)", () => {
    const ax = xAxis(params({ windowSeconds: 0 }));
    // Regression #95: min/max must be present-and-null, not absent. echarts
    // merges the xAxis on setOption, so an absent bound leaves the previous
    // window's clamp in place and "All history" appears to do nothing.
    expect(ax).toHaveProperty("min", null);
    expect(ax).toHaveProperty("max", null);
  });

  it("clears the previous window's bounds when switching finite -> All history", () => {
    // Simulate the bug's repro: build with a finite window, then all-history.
    xAxis(params({ windowSeconds: 900 }));
    const cleared = xAxis(params({ windowSeconds: 0 }));
    expect(cleared.min).toBeNull();
    expect(cleared.max).toBeNull();
  });

  it("handles empty history without crashing", () => {
    const opt = buildChartOption(params({ history: [] }));
    const ax = opt.xAxis as { min?: unknown; max?: unknown };
    expect(ax.min).toBeNull();
    expect(ax.max).toBeNull();
    expect((opt.series as { data: unknown[] }[])[0].data).toEqual([]);
  });
});

describe("buildChartOption theme", () => {
  const tooltip = (p: ChartOptionParams) =>
    buildChartOption(p).tooltip as {
      backgroundColor: string;
      textStyle: { color: string };
    };

  it("defaults to the dark chrome palette", () => {
    expect(tooltip(params()).backgroundColor).toBe("#1f1e1e");
  });

  it("uses the light chrome palette when theme is light", () => {
    const dark = tooltip(params({ theme: "dark" }));
    const light = tooltip(params({ theme: "light" }));
    expect(light.backgroundColor).toBe("#ffffff");
    expect(light.backgroundColor).not.toBe(dark.backgroundColor);
    expect(light.textStyle.color).not.toBe(dark.textStyle.color);
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
