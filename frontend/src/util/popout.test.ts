import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writable } from "svelte/store";

const OpenChartWindow = vi.fn();
const OpenBrokerStatusWindow = vi.fn();
const OpenTopicWindow = vi.fn();
const FocusTopicWindow = vi.fn();

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  OpenChartWindow: (...args: unknown[]) => OpenChartWindow(...args),
  OpenBrokerStatusWindow: (...args: unknown[]) =>
    OpenBrokerStatusWindow(...args),
  OpenTopicWindow: (...args: unknown[]) => OpenTopicWindow(...args),
  FocusTopicWindow: (...args: unknown[]) => FocusTopicWindow(...args),
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
  buildTopicWindowURL,
  openChartWindow,
  openBrokerStatusWindow,
  openTopicWindow,
  focusTopicWindow,
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

describe("buildTopicWindowURL", () => {
  it("matches the backend's encoding exactly for the simple case", () => {
    // Go's url.Values.Encode() sorts keys and the Go builder omits an empty
    // topic, so this is exactly what buildTopicWindowURL in
    // backend/app/windows.go yields.
    expect(buildTopicWindowURL({ connectionId: 3, topic: "" })).toBe(
      "/?conn=3&view=topic"
    );
  });

  it("survives topics with reserved and non-ASCII characters", () => {
    const topic = "spaced topic/+/ü&?=#/end";
    const url = buildTopicWindowURL({ connectionId: 2, topic });
    expect(url.startsWith("/?")).toBe(true);
    const params = new URLSearchParams(url.slice(2));
    expect(params.get("view")).toBe("topic");
    expect(params.get("conn")).toBe("2");
    expect(params.get("topic")).toBe(topic);
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

  // The topic tests below each use their own connection id: popout.ts keeps a
  // module-level map of opened topic tabs that persists across tests within
  // this file, so sharing an id would leak a tab handle between tests.

  it("topic window uses the native bindings on desktop", async () => {
    await openTopicWindow({ connectionId: 1, topic: "a/b" });
    expect(OpenTopicWindow).toHaveBeenCalledWith({
      connectionId: 1,
      topic: "a/b",
    });
    expect(windowOpen).not.toHaveBeenCalled();

    await focusTopicWindow({ connectionId: 1, topic: "a/b" });
    expect(FocusTopicWindow).toHaveBeenCalledWith({
      connectionId: 1,
      topic: "a/b",
    });
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("topic window opens one named tab per connection in server mode and reuses it", async () => {
    mockEnv.set({ isServerMode: true });
    const tab = { closed: false, focus: vi.fn() };
    windowOpen.mockReturnValue(tab);

    await openTopicWindow({ connectionId: 5, topic: "x/y" });
    expect(OpenTopicWindow).not.toHaveBeenCalled();
    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith(
      buildTopicWindowURL({ connectionId: 5, topic: "x/y" }),
      "mv-topic-5"
    );

    // A later selection must not reload the tab (the selection follows via
    // the TopicWindowSelect event) and must not steal focus from the tree.
    await openTopicWindow({ connectionId: 5, topic: "x/z" });
    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(tab.focus).not.toHaveBeenCalled();

    // An explicit focus request switches to the existing tab.
    await focusTopicWindow({ connectionId: 5, topic: "x/z" });
    expect(FocusTopicWindow).not.toHaveBeenCalled();
    expect(tab.focus).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledTimes(1);

    // Once the user closes the tab, the next open creates a fresh one.
    tab.closed = true;
    await openTopicWindow({ connectionId: 5, topic: "x/z" });
    expect(windowOpen).toHaveBeenCalledTimes(2);

    windowOpen.mockReset();
  });

  it("topic window rejects when the browser blocks the pop-up", async () => {
    mockEnv.set({ isServerMode: true });
    windowOpen.mockReturnValue(null);

    await expect(
      openTopicWindow({ connectionId: 7, topic: "a" })
    ).rejects.toThrow(/blocked/);
    expect(OpenTopicWindow).not.toHaveBeenCalled();

    windowOpen.mockReset();
  });
});
