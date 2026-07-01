import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import {
  createChartSeriesStore,
  labelForPath,
  CHART_PALETTE,
} from "./chart-series-store";

describe("labelForPath", () => {
  it("uses the last segment, or 'value' for a bare payload", () => {
    expect(labelForPath("temp")).toBe("temp");
    expect(labelForPath("sensor.rssi")).toBe("rssi");
    expect(labelForPath("")).toBe("value");
  });
});

describe("chart-series-store", () => {
  it("adds a series with the first palette colour and a label", () => {
    const store = createChartSeriesStore();
    store.toggleField("temp");
    const series = get(store);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      path: "temp",
      label: "temp",
      color: CHART_PALETTE[0],
      visible: true,
    });
  });

  it("toggles a field off when already selected", () => {
    const store = createChartSeriesStore();
    store.toggleField("temp");
    store.toggleField("temp");
    expect(get(store)).toHaveLength(0);
  });

  it("assigns distinct colours and reuses freed ones", () => {
    const store = createChartSeriesStore();
    store.toggleField("a");
    store.toggleField("b");
    expect(get(store).map((s) => s.color)).toEqual([
      CHART_PALETTE[0],
      CHART_PALETTE[1],
    ]);
    store.removeSeries("a"); // frees palette[0]
    store.toggleField("c");
    const colors = get(store).map((s) => s.color);
    expect(colors).toContain(CHART_PALETTE[0]); // reused for c
    expect(colors).toContain(CHART_PALETTE[1]); // b kept
  });

  it("addField is idempotent", () => {
    const store = createChartSeriesStore();
    store.addField("x");
    store.addField("x");
    expect(get(store)).toHaveLength(1);
  });

  it("setVisible flips a series' visibility", () => {
    const store = createChartSeriesStore();
    store.addField("x");
    store.setVisible("x", false);
    expect(get(store)[0].visible).toBe(false);
    store.setVisible("x", true);
    expect(get(store)[0].visible).toBe(true);
  });

  it("clear empties the store", () => {
    const store = createChartSeriesStore([
      { path: "a", label: "a", color: "#fff", visible: true },
    ]);
    store.clear();
    expect(get(store)).toHaveLength(0);
  });

  it("isSelected reflects membership", () => {
    const store = createChartSeriesStore();
    expect(store.isSelected("a")).toBe(false);
    store.addField("a");
    expect(store.isSelected("a")).toBe(true);
  });

  it("seeds from an initial series list", () => {
    const store = createChartSeriesStore([
      { path: "temp", label: "temp", color: "#f5a623", visible: true },
    ]);
    expect(get(store)).toHaveLength(1);
  });
});
