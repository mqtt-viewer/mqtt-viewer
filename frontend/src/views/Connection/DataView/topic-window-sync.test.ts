import { describe, it, expect } from "vitest";
import { topicWindowSyncAction } from "./topic-window-sync";

describe("topicWindowSyncAction", () => {
  it("does not open a window when the mode is restored with nothing selected", () => {
    expect(
      topicWindowSyncAction({
        dockMode: "window",
        isActiveTab: true,
        topic: null,
        lastEmittedTopic: undefined,
      })
    ).toBe("emit");
  });

  it("opens the pop-out for a real selection", () => {
    expect(
      topicWindowSyncAction({
        dockMode: "window",
        isActiveTab: true,
        topic: "factory/line/temperature",
        lastEmittedTopic: undefined,
      })
    ).toBe("open-and-emit");
  });

  it("does nothing while the topic is unchanged", () => {
    expect(
      topicWindowSyncAction({
        dockMode: "window",
        isActiveTab: true,
        topic: "factory/line/temperature",
        lastEmittedTopic: "factory/line/temperature",
      })
    ).toBe("none");
    expect(
      topicWindowSyncAction({
        dockMode: "window",
        isActiveTab: true,
        topic: null,
        lastEmittedTopic: null,
      })
    ).toBe("none");
  });

  it("emits the deselect to an open pop-out", () => {
    expect(
      topicWindowSyncAction({
        dockMode: "window",
        isActiveTab: true,
        topic: null,
        lastEmittedTopic: "factory/line/temperature",
      })
    ).toBe("emit");
  });

  it("resets when the panel is docked in this window", () => {
    for (const dockMode of ["right", "bottom"] as const) {
      expect(
        topicWindowSyncAction({
          dockMode,
          isActiveTab: true,
          topic: "factory/line/temperature",
          lastEmittedTopic: undefined,
        })
      ).toBe("reset");
    }
  });

  it("resets on a background tab, whatever the mode", () => {
    expect(
      topicWindowSyncAction({
        dockMode: "window",
        isActiveTab: false,
        topic: "factory/line/temperature",
        lastEmittedTopic: "factory/line/temperature",
      })
    ).toBe("reset");
  });
});
