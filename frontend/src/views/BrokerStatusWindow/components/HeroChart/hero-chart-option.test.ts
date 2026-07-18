import { describe, it, expect } from "vitest";
import {
  buildHeroChartOption,
  heroSeriesColor,
  type HeroChartOptionParams,
  type HeroSeries,
} from "./hero-chart-option";
import { CHART_PALETTE } from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/chart-series-store";

const NOW = 1_700_000_000_000;

const inSeries: HeroSeries = {
  id: "in",
  label: "In",
  dashed: false,
  emphasis: true,
  points: [
    { t: NOW - 2000, v: 10 },
    { t: NOW - 1000, v: 12 },
    { t: NOW, v: 11 },
  ],
};

const outSeries: HeroSeries = {
  id: "out",
  label: "Out",
  dashed: false,
  points: [
    { t: NOW - 2000, v: 20 },
    { t: NOW - 1000, v: 22 },
    { t: NOW, v: 21 },
  ],
};

const observedSeries: HeroSeries = {
  id: "observed",
  label: "Observed",
  dashed: true,
  points: [
    { t: NOW - 2000, v: 8 },
    { t: NOW - 1000, v: 9 },
    { t: NOW, v: 9 },
  ],
};

const params = (
  over: Partial<HeroChartOptionParams> = {}
): HeroChartOptionParams => ({
  series: [inSeries, outSeries, observedSeries],
  windowMinutes: 5,
  now: NOW,
  ...over,
});

type Series = { id: string; name: string; data: [number, number | null][] }[];
type Line = {
  lineStyle: { color: string; type: string; opacity: number; width: number };
  connectNulls: boolean;
};

const seriesOf = (p: HeroChartOptionParams) =>
  buildHeroChartOption(p).series as unknown as (Series[number] & Line)[];

const xAxis = (p: HeroChartOptionParams) =>
  buildHeroChartOption(p).xAxis as { min: number; max: number };

describe("buildHeroChartOption series mapping", () => {
  it("maps each series by stable id, name and point pairs", () => {
    const s = seriesOf(params());
    expect(s.map((e) => e.id)).toEqual(["in", "out", "observed"]);
    expect(s[0].name).toBe("In");
    expect(s[0].data).toEqual([
      [NOW - 2000, 10],
      [NOW - 1000, 12],
      [NOW, 11],
    ]);
  });

  it("disables ECharts legend and animation", () => {
    const opt = buildHeroChartOption(params());
    expect((opt.legend as { show: boolean }).show).toBe(false);
    expect(opt.animation).toBe(false);
  });
});

describe("buildHeroChartOption window bounds", () => {
  it("anchors x-axis min/max to now minus the window", () => {
    const ax = xAxis(params({ windowMinutes: 5 }));
    expect(ax.min).toBe(NOW - 5 * 60_000);
    expect(ax.max).toBe(NOW);
  });

  it("tracks a different window width", () => {
    const ax = xAxis(params({ windowMinutes: 15 }));
    expect(ax.min).toBe(NOW - 15 * 60_000);
    expect(ax.max).toBe(NOW);
  });
});

describe("buildHeroChartOption theme", () => {
  const tooltipBg = (p: HeroChartOptionParams) =>
    (buildHeroChartOption(p).tooltip as { backgroundColor: string })
      .backgroundColor;

  it("defaults to the dark chrome palette", () => {
    expect(tooltipBg(params())).toBe("#1f1e1e");
  });

  it("uses the light chrome palette when theme is light", () => {
    const light = tooltipBg(params({ theme: "light" }));
    expect(light).toBe("#ffffff");
    expect(light).not.toBe(tooltipBg(params({ theme: "dark" })));
  });
});

describe("buildHeroChartOption dashed flag", () => {
  it("renders the observed series dashed and muted, solid series opaque", () => {
    const s = seriesOf(params());
    const observed = s.find((e) => e.id === "observed")!;
    const inbound = s.find((e) => e.id === "in")!;
    expect(observed.lineStyle.type).toBe("dashed");
    expect(observed.lineStyle.opacity).toBeLessThan(1);
    expect(inbound.lineStyle.type).toBe("solid");
    expect(inbound.lineStyle.opacity).toBe(1);
  });

  it("gives the emphasis series a heavier line", () => {
    const s = seriesOf(params());
    expect(s.find((e) => e.id === "in")!.lineStyle.width).toBeGreaterThan(
      s.find((e) => e.id === "out")!.lineStyle.width
    );
  });

  it("promotes a lone non-dashed series to the primary colour", () => {
    const solo: HeroSeries = { ...observedSeries, dashed: false };
    const s = seriesOf(params({ series: [solo] }));
    expect(s[0].lineStyle.color).toBe(CHART_PALETTE[1]);
    expect(heroSeriesColor(solo, 0, 1)).toBe(CHART_PALETTE[1]);
  });

  it("colours multiple series from the shared palette in order", () => {
    expect(heroSeriesColor(inSeries, 0, 3)).toBe(CHART_PALETTE[0]);
    expect(heroSeriesColor(outSeries, 1, 3)).toBe(CHART_PALETTE[1]);
  });
});

describe("buildHeroChartOption null gaps", () => {
  it("keeps null values as gap markers and disables bridging", () => {
    const gapped: HeroSeries = {
      id: "in",
      label: "In",
      dashed: false,
      points: [
        { t: NOW - 2000, v: 10 },
        { t: NOW - 1000, v: null },
        { t: NOW, v: 12 },
      ],
    };
    const s = seriesOf(params({ series: [gapped] }));
    expect(s[0].connectNulls).toBe(false);
    expect(s[0].data).toEqual([
      [NOW - 2000, 10],
      [NOW - 1000, null],
      [NOW, 12],
    ]);
  });
});

describe("buildHeroChartOption empty series", () => {
  it("builds a valid option with no series without crashing", () => {
    const opt = buildHeroChartOption(params({ series: [] }));
    expect(opt.series).toEqual([]);
    const ax = opt.xAxis as { min: number; max: number };
    expect(ax.min).toBe(NOW - 5 * 60_000);
    expect(ax.max).toBe(NOW);
  });
});
