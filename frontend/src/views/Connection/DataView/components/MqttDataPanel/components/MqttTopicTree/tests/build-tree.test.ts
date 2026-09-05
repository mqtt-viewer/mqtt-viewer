import { describe, expect, it } from "vitest";
import type { MqttData } from "../../../stores/mqtt-data";
import { buildTree } from "../build-tree";

const node = (
  topic: string,
  children: MqttData = {},
  message?: string
): MqttData[string] => ({
  topic,
  isDecodedProto: false,
  isRetained: false,
  latestMessageTime: new Date(0),
  message,
  messageCount: message === undefined ? 0 : 1,
  subtopicCount: Object.keys(children).length,
  children,
});

const data: MqttData = {
  factory: node("factory", {
    line1: node("factory/line1", {
      temperature: node("factory/line1/temperature", {}, "21.4"),
      pressure: node("factory/line1/pressure", {}, "1.02"),
    }),
  }),
};

const build = (pinnedTopics: Set<string>, expanded: string[]) =>
  buildTree({
    data,
    expandedTopics: new Set(expanded),
    pinnedTopics,
    sortKey: "topic",
    sortDir: "asc",
    searchText: "",
  });

describe("buildTree pinned marking", () => {
  it("marks nothing when nothing is pinned", () => {
    const rows = build(new Set(), ["factory", "factory/line1"]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.isPinned === false)).toBe(true);
  });

  it("marks only the pinned rows, at any depth", () => {
    const rows = build(new Set(["factory/line1/temperature", "factory"]), [
      "factory",
      "factory/line1",
    ]);
    const pinned = rows.filter((row) => row.isPinned).map((row) => row.topic);
    expect(pinned.sort()).toEqual(["factory", "factory/line1/temperature"]);
  });

  it("matches on the full topic path, not the level name", () => {
    // "temperature" is the level name; only the full path counts.
    const rows = build(new Set(["temperature"]), ["factory", "factory/line1"]);
    expect(rows.every((row) => row.isPinned === false)).toBe(true);
  });

  it("does not mark a collapsed pinned descendant that is not rendered", () => {
    const rows = build(new Set(["factory/line1/temperature"]), []);
    expect(rows.map((row) => row.topic)).toEqual(["factory"]);
    expect(rows[0].isPinned).toBe(false);
  });
});
