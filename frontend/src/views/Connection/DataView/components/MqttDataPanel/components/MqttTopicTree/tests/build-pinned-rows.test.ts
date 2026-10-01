import { describe, expect, it } from "vitest";
import type { MqttData } from "../../../stores/mqtt-data";
import { buildPinnedRows, type PinnedBlockRow } from "../build-pinned-rows";

const node = (
  topic: string,
  children: MqttData = {},
  message?: string,
  latestMs = 0
): MqttData[string] => ({
  topic,
  isDecodedProto: false,
  isRetained: false,
  latestMessageTime: new Date(latestMs),
  message,
  messageCount: message === undefined ? 0 : 1,
  subtopicCount: Object.keys(children).length,
  children,
});

const data: MqttData = {
  factory: node("factory", {
    line1: node("factory/line1", {
      temperature: node("factory/line1/temperature", {}, "21.4", 2000),
      pressure: node("factory/line1/pressure", {}, "1.02", 1000),
      motor: node("factory/line1/motor", {
        rpm: node("factory/line1/motor/rpm", {}, "1200"),
      }),
    }),
    line2: node("factory/line2", {}, "idle"),
  }),
};

// A plain list opens those topics under every pin, which is all most cases
// need; a record sets each pin's own entry.
const build = (
  pinnedTopics: string[],
  expanded: string[] | Record<string, string[]> = [],
  overrides: Partial<Parameters<typeof buildPinnedRows>[0]> = {}
) =>
  buildPinnedRows({
    data,
    pinnedTopics,
    pinnedSet: new Set(pinnedTopics),
    expansion: new Map(
      Array.isArray(expanded)
        ? pinnedTopics.map((pin) => [pin, new Set(expanded)])
        : Object.entries(expanded).map(([pin, t]) => [pin, new Set(t)])
    ),
    sortKey: "topic",
    sortDir: "desc",
    searchText: "",
    ...overrides,
  });

const summary = (rows: PinnedBlockRow[]) =>
  rows.map((row) =>
    row.kind === "placeholder"
      ? `placeholder ${row.topic}`
      : `${row.kind} ${row.levelCount} ${row.topicLevel}`
  );

describe("buildPinnedRows", () => {
  it("renders collapsed pins as single rows labelled with the full path", () => {
    const rows = build(["factory/line1", "factory/line2"]);
    expect(summary(rows)).toEqual([
      "pin 0 factory/line1",
      "pin 0 factory/line2",
    ]);
  });

  it("keeps pin order for the top level rather than sorting it", () => {
    const rows = build(["factory/line2", "factory/line1"]);
    expect(summary(rows)).toEqual([
      "pin 0 factory/line2",
      "pin 0 factory/line1",
    ]);
  });

  it("shows a placeholder for a pin with no node yet", () => {
    const rows = build(["warehouse/door", "factory/line2"]);
    expect(rows[0]).toEqual({ kind: "placeholder", topic: "warehouse/door" });
    expect(summary(rows)).toEqual([
      "placeholder warehouse/door",
      "pin 0 factory/line2",
    ]);
  });

  it("lists an expanded pin's children beneath it, by last level", () => {
    const rows = build(["factory/line1"], ["factory/line1"]);
    expect(summary(rows)).toEqual([
      "pin 0 factory/line1",
      "descendant 1 motor",
      "descendant 1 pressure",
      "descendant 1 temperature",
    ]);
    const temperature = rows[3];
    expect(temperature.kind === "descendant" && temperature.topic).toBe(
      "factory/line1/temperature"
    );
  });

  it("recurses only into expanded descendants", () => {
    const collapsed = build(["factory"], ["factory"]);
    expect(summary(collapsed)).toEqual([
      "pin 0 factory",
      "descendant 1 line1",
      "descendant 1 line2",
    ]);
    const open = build(
      ["factory"],
      ["factory", "factory/line1", "factory/line1/motor"]
    );
    expect(summary(open)).toEqual([
      "pin 0 factory",
      "descendant 1 line1",
      "descendant 2 motor",
      "descendant 3 rpm",
      "descendant 2 pressure",
      "descendant 2 temperature",
      "descendant 1 line2",
    ]);
  });

  it("does not show children of a descendant that is expanded but under a collapsed parent", () => {
    // The expanded set can hold a grandchild while its parent is closed; the
    // walk never reaches it, so nothing leaks into the block.
    const rows = build(["factory"], ["factory", "factory/line1/motor"]);
    expect(summary(rows)).toEqual([
      "pin 0 factory",
      "descendant 1 line1",
      "descendant 1 line2",
    ]);
  });

  it("orders children by the tree's sort", () => {
    const rows = build(["factory/line1"], ["factory/line1"], {
      sortKey: "time",
      sortDir: "desc",
    });
    // Newest first under time/desc, same as the tree.
    expect(summary(rows).slice(1)).toEqual([
      "descendant 1 temperature",
      "descendant 1 pressure",
      "descendant 1 motor",
    ]);
  });

  it("marks descendants that are themselves pinned", () => {
    const rows = build(["factory", "factory/line1/temperature"], [
      "factory",
      "factory/line1",
    ]);
    const pinned = rows
      .filter((row) => row.kind === "descendant" && row.isPinned)
      .map((row) => row.kind !== "placeholder" && row.topic);
    expect(pinned).toEqual(["factory/line1/temperature"]);
    // The nested pin still gets its own top-level row too.
    expect(summary(rows).at(-1)).toBe("pin 0 factory/line1/temperature");
  });

  it("reports expansion and counts on the pin row", () => {
    const [row] = build(["factory/line1"], ["factory/line1"]);
    expect(row.kind).toBe("pin");
    if (row.kind === "placeholder") return;
    expect(row.isExpanded).toBe(true);
    expect(row.countSubtopicTotal).toBe(3);
    expect(row.isPinned).toBe(true);
  });

  it("keeps a topic's expansion apart under each pin it shows beneath", () => {
    // factory/line1 is a pin of its own and a descendant of factory.
    const pins = ["factory", "factory/line1"];
    const openUnderFactory = build(pins, {
      factory: ["factory", "factory/line1"],
    });
    expect(summary(openUnderFactory)).toEqual([
      "pin 0 factory",
      "descendant 1 line1",
      "descendant 2 motor",
      "descendant 2 pressure",
      "descendant 2 temperature",
      "descendant 1 line2",
      "pin 0 factory/line1",
    ]);

    const openAsPin = build(pins, {
      factory: ["factory"],
      "factory/line1": ["factory/line1"],
    });
    expect(summary(openAsPin)).toEqual([
      "pin 0 factory",
      "descendant 1 line1",
      "descendant 1 line2",
      "pin 0 factory/line1",
      "descendant 1 motor",
      "descendant 1 pressure",
      "descendant 1 temperature",
    ]);
  });

  it("tags every row with the pin it sits under", () => {
    const rows = build(["factory", "factory/line1"], {
      factory: ["factory", "factory/line1"],
      "factory/line1": ["factory/line1"],
    });
    const roots = rows.map((row) =>
      row.kind === "placeholder" ? null : `${row.topic} < ${row.pinRoot}`
    );
    expect(roots).toContain("factory/line1 < factory");
    expect(roots).toContain("factory/line1 < factory/line1");
    expect(roots).toContain("factory/line1/motor < factory");
    expect(roots).toContain("factory/line1/motor < factory/line1");
  });

  describe("with a search", () => {
    const search = (
      pins: string[],
      searchText: string,
      expanded: string[] | Record<string, string[]> = []
    ) => summary(build(pins, expanded, { searchText }));

    it("keeps a pin whose full path matches, though no single level does", () => {
      expect(search(["factory/line1"], "y/line")).toEqual([
        "pin 0 factory/line1",
      ]);
    });

    it("keeps a pin when only something beneath it matches, and prunes the rest", () => {
      const pins = ["factory/line1", "factory/line2"];
      expect(search(pins, "rpm", ["factory/line1", "factory/line1/motor"]))
        .toEqual([
          "pin 0 factory/line1",
          "descendant 1 motor",
          "descendant 2 rpm",
        ]);
      // Counted as the tree counts a filtered branch.
      const [pin] = build(pins, [], { searchText: "rpm" });
      expect(pin.kind !== "placeholder" && pin.countSubtopicTotal).toBe(1);
    });

    it("matches payloads, as the tree does", () => {
      expect(search(["factory/line1", "factory/line2"], "idle")).toEqual([
        "pin 0 factory/line2",
      ]);
    });

    it("matches a placeholder on its path only", () => {
      expect(search(["warehouse/door", "factory/line2"], "door")).toEqual([
        "placeholder warehouse/door",
      ]);
      expect(search(["warehouse/door"], "idle")).toEqual([]);
    });

    it("shows nothing when nothing matches", () => {
      expect(search(["factory", "warehouse/door"], "nothing-here")).toEqual(
        []
      );
    });

    it("opens nothing and leaves the expansion it was given alone", () => {
      const expansion = new Map([["factory", new Set(["factory"])]]);
      const rows = buildPinnedRows({
        data,
        pinnedTopics: ["factory"],
        pinnedSet: new Set(["factory"]),
        expansion,
        sortKey: "topic",
        sortDir: "desc",
        searchText: "rpm",
      });
      // line1 holds the match but stays closed, as it would in the tree.
      expect(summary(rows)).toEqual(["pin 0 factory", "descendant 1 line1"]);
      expect([...expansion]).toEqual([["factory", new Set(["factory"])]]);
    });

    it("leaves the data it was given untouched", () => {
      build(["factory"], ["factory"], { searchText: "rpm" });
      expect(data.factory.subtopicCount).toBe(2);
      expect(Object.keys(data.factory.children)).toEqual(["line1", "line2"]);
    });
  });
});
