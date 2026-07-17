import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writable } from "svelte/store";

const OpenChartWindow = vi.fn();
const OpenBrokerStatusWindow = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  OpenChartWindow: (...args: unknown[]) => OpenChartWindow(...args),
  OpenBrokerStatusWindow: (...args: unknown[]) =>
    OpenBrokerStatusWindow(...args),
}));

const mockEnv = writable({ isServerMode: false });
vi.mock("@/stores/env", () => ({
  default: {
    subscribe: (run: (value: unknown) => void) => mockEnv.subscribe(run),
  },
}));

import {
  buildChartWindowURL,
  buildStatusWindowURL,
  openChartWindow,
  openBrokerStatusWindow,
} from "./popout";

describe("buildChartWindowURL", () => {
  it("round-trips the params the chart window reads", () => {
    const url = buildChartWindowURL({
      connectionId: 7,
      topic: "home/sensors/temp",
      fields: ["payload.temp", "payload.humidity"],
    });
    expect(url.startsWith("/?")).toBe(true);
    const params = new URLSearchParams(url.slice(2));
    expect(params.get("view")).toBe("chart");
    expect(params.get("conn")).toBe("7");
    expect(params.get("topic")).toBe("home/sensors/temp");
    expect(JSON.parse(params.get("fields") ?? "[]")).toEqual([
      "payload.temp",
      "payload.humidity",
    ]);
  });

  it("omits fields when empty, mirroring the backend", () => {
    const url = buildChartWindowURL({
      connectionId: 1,
      topic: "a/b",
      fields: [],
    });
    const params = new URLSearchParams(url.slice(2));
    expect(params.has("fields")).toBe(false);
  });

  it("survives topics with reserved and non-ASCII characters", () => {
    const topic = "spaced topic/+/ü&?=#/end";
    const url = buildChartWindowURL({
      connectionId: 2,
      topic,
      fields: ["a b", "c&d"],
    });
    const params = new URLSearchParams(url.slice(2));
    expect(params.get("topic")).toBe(topic);
    expect(JSON.parse(params.get("fields") ?? "[]")).toEqual(["a b", "c&d"]);
  });
});

describe("buildStatusWindowURL", () => {
  it("matches the backend's encoding exactly for the simple case", () => {
    // Go's url.Values.Encode() sorts keys, so conn precedes view.
    // buildStatusWindowURL in backend/app/windows.go yields this string.
    expect(buildStatusWindowURL(3)).toBe("/?conn=3&view=status");
  });
});

describe("open helpers", () => {
  const windowOpen = vi.fn();
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = { open: windowOpen };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    mockEnv.set({ isServerMode: false });
  });

  it("uses the native binding on desktop", () => {
    openChartWindow({ connectionId: 1, topic: "a/b", fields: ["x"] });
    expect(OpenChartWindow).toHaveBeenCalledWith({
      connectionId: 1,
      topic: "a/b",
      fields: ["x"],
    });
    expect(windowOpen).not.toHaveBeenCalled();

    openBrokerStatusWindow(1);
    expect(OpenBrokerStatusWindow).toHaveBeenCalledWith(1);
  });

  it("opens a named tab in server mode so re-opening reuses it", () => {
    mockEnv.set({ isServerMode: true });

    openChartWindow({ connectionId: 4, topic: "a/b", fields: [] });
    expect(OpenChartWindow).not.toHaveBeenCalled();
    expect(windowOpen).toHaveBeenCalledWith(
      buildChartWindowURL({ connectionId: 4, topic: "a/b", fields: [] }),
      "mv-chart-4-a/b"
    );

    openBrokerStatusWindow(4);
    expect(OpenBrokerStatusWindow).not.toHaveBeenCalled();
    expect(windowOpen).toHaveBeenCalledWith("/?conn=4&view=status", "mv-status-4");
  });
});
