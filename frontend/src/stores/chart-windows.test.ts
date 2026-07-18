import { describe, expect, it, vi, beforeEach } from "vitest";

const getChartWindows = vi.fn();
const updateChartWindow = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetChartWindows: (...args: unknown[]) => getChartWindows(...args),
  UpdateChartWindow: (...args: unknown[]) => updateChartWindow(...args),
}));

describe("chart-windows store", () => {
  beforeEach(() => {
    vi.resetModules();
    getChartWindows.mockReset();
    updateChartWindow.mockReset();
  });

  it("get returns 0 for a connection with no persisted row", async () => {
    getChartWindows.mockResolvedValue([]);
    const chartWindows = (await import("./chart-windows")).default;

    await chartWindows.init();

    expect(chartWindows.get(1)).toBe(0);
  });

  it("init loads all rows exactly once, even with concurrent/repeat calls", async () => {
    getChartWindows.mockResolvedValue([
      { id: "1", windowSeconds: 300 },
      { id: "2", windowSeconds: 7200 },
    ]);
    const chartWindows = (await import("./chart-windows")).default;

    await Promise.all([chartWindows.init(), chartWindows.init()]);
    await chartWindows.init();

    expect(getChartWindows).toHaveBeenCalledTimes(1);
    expect(chartWindows.get(1)).toBe(300);
    expect(chartWindows.get("2")).toBe(7200);
    expect(chartWindows.get(3)).toBe(0);
  });

  it("set updates the cache immediately and writes through to the backend", async () => {
    getChartWindows.mockResolvedValue([]);
    updateChartWindow.mockResolvedValue(undefined);
    const chartWindows = (await import("./chart-windows")).default;

    await chartWindows.init();
    chartWindows.set(1, 900);

    expect(chartWindows.get(1)).toBe(900);
    expect(updateChartWindow).toHaveBeenCalledWith("1", 900);
  });

  it("keeps distinct connections independent", async () => {
    getChartWindows.mockResolvedValue([]);
    updateChartWindow.mockResolvedValue(undefined);
    const chartWindows = (await import("./chart-windows")).default;

    await chartWindows.init();
    chartWindows.set(1, 300);
    chartWindows.set(2, 43200);

    expect(chartWindows.get(1)).toBe(300);
    expect(chartWindows.get(2)).toBe(43200);
  });
});
