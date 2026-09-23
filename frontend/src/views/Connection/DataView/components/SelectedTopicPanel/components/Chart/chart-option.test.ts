import { describe, it, expect } from "vitest";
import {
  buildChartOption,
  CHROME_COLORS,
  type ChartOptionParams,
} from "./chart-option";
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

// Access xAxis/yAxis as the single-object form buildChartOption always produces.
const xAxis = (p: ChartOptionParams) =>
  buildChartOption(p).xAxis as { min?: unknown; max?: unknown };
const yAxis = (p: ChartOptionParams) =>
  buildChartOption(p).yAxis as { min?: unknown; max?: unknown; scale?: unknown };

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

describe("CHROME_COLORS export", () => {
  // Pinned because hero-chart-option.ts consumes this exact palette; a silent
  // hue change here would drift the broker-status hero axis/tooltip chrome.
  it("pins the dark chrome palette", () => {
    expect(CHROME_COLORS.dark).toEqual({
      axis: "#525252",
      label: "#aeaeae",
      splitLine: "#2e2e2e",
      tooltipBackground: "#1f1e1e",
      tooltipBorder: "#525252",
      tooltipText: "#eee",
    });
  });

  it("pins the light chrome palette", () => {
    expect(CHROME_COLORS.light).toEqual({
      axis: "#b8b8c0",
      label: "#5f5f69",
      splitLine: "#e4e4e8",
      tooltipBackground: "#ffffff",
      tooltipBorder: "#c8c8ce",
      tooltipText: "#26262b",
    });
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

  it("keeps one pre-window point per series so the line still draws into the left edge", () => {
    const opt = buildChartOption(
      params({
        history: [
          msg(NOW - 3_600_000, '{"temp":10000000}'),
          msg(NOW - 200 * 1000, '{"temp":21}'),
          msg(NOW - 100 * 1000, '{"temp":22}'),
        ],
        windowSeconds: 300,
      })
    );
    const s = opt.series as { data: [number, number][] }[];
    expect(s[0].data).toEqual([
      [NOW - 3_600_000, 10000000],
      [NOW - 200 * 1000, 21],
      [NOW - 100 * 1000, 22],
    ]);
  });

  it("keeps only the most recent pre-window point when several exist", () => {
    const opt = buildChartOption(
      params({
        history: [
          msg(NOW - 500 * 1000, '{"temp":5}'),
          msg(NOW - 400 * 1000, '{"temp":9}'),
          msg(NOW - 100 * 1000, '{"temp":22}'),
        ],
        windowSeconds: 300,
      })
    );
    const s = opt.series as { data: [number, number][] }[];
    expect(s[0].data).toEqual([
      [NOW - 400 * 1000, 9],
      [NOW - 100 * 1000, 22],
    ]);
  });

  it("keeps the full history's data when windowSeconds is 0 (All history)", () => {
    const opt = buildChartOption(
      params({
        history: [msg(NOW - 3_600_000, '{"temp":10000000}'), msg(NOW, '{"temp":22}')],
        windowSeconds: 0,
      })
    );
    const s = opt.series as { data: [number, number][] }[];
    expect(s[0].data).toEqual([
      [NOW - 3_600_000, 10000000],
      [NOW, 22],
    ]);
  });
});

describe("buildChartOption yAxis bounds", () => {
  it("ranges only over in-window values, ignoring an older leading point (regression)", () => {
    // This is the reported bug: an all-time spike kept the Y-axis stretched
    // even after the X-axis window narrowed to a recent, low-value slice,
    // so the visible points rendered collapsed at the bottom of the chart.
    const ax = yAxis(
      params({
        history: [
          msg(NOW - 3_600_000, '{"temp":10000000}'),
          msg(NOW - 200 * 1000, '{"temp":21}'),
          msg(NOW - 100 * 1000, '{"temp":22}'),
        ],
        windowSeconds: 300,
      })
    );
    expect(ax.min).toBeCloseTo(20.9);
    expect(ax.max).toBeCloseTo(22.1);
  });

  it("merges the in-window extent across multiple visible series", () => {
    const ax = yAxis(
      params({
        series: [
          { path: "a", label: "a", color: "#f5a623", visible: true },
          { path: "b", label: "b", color: "#7788fc", visible: true },
        ],
        history: [
          msg(NOW - 100 * 1000, '{"a":10,"b":-5}'),
          msg(NOW - 50 * 1000, '{"a":20,"b":3}'),
        ],
        windowSeconds: 300,
      })
    );
    // Span is the union of both series' ranges ([10,20] and [-5,3]), not
    // just one of them: [-5, 20], padded by 10% of that 25-wide range.
    expect(ax.min).toBeCloseTo(-7.5);
    expect(ax.max).toBeCloseTo(22.5);
  });

  it("falls back to scale:true (auto-fit) for All history, explicitly clearing any prior window's bounds", () => {
    // Regression #95, on the Y-axis this time: echarts deep-merges yAxis on
    // setOption, so an absent min/max here would leave a previous windowed
    // render's numeric bounds clamped in place.
    const ax = yAxis(
      params({
        history: [msg(NOW - 3_600_000, '{"temp":10000000}'), msg(NOW, '{"temp":22}')],
        windowSeconds: 0,
      })
    );
    expect(ax.scale).toBe(true);
    expect(ax).toHaveProperty("min", null);
    expect(ax).toHaveProperty("max", null);
  });

  it("falls back to scale:true when the window contains no points, but still draws the leading point", () => {
    const opt = buildChartOption(
      params({
        history: [msg(NOW - 3_600_000, '{"temp":10000000}')],
        windowSeconds: 300,
      })
    );
    const ax = opt.yAxis as { scale?: unknown; min?: unknown; max?: unknown };
    expect(ax.scale).toBe(true);
    expect(ax).toHaveProperty("min", null);
    expect(ax).toHaveProperty("max", null);
    const s = opt.series as { data: [number, number][] }[];
    expect(s[0].data).toEqual([[NOW - 3_600_000, 10000000]]);
  });
});
