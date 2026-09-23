import { describe, it, expect } from "vitest";
import {
  allExpansionKeys,
  buildSparkplugTree,
  metricListJson,
  needsRebirth,
  nodeProblems,
  totalMetricCount,
} from "./build-sparkplug-tree";
import type {
  SparkplugGroup,
  SparkplugMetric,
  SparkplugNode,
} from "../../stores/sparkplug-tree-store";

const metric = (name: string, over: Partial<SparkplugMetric> = {}): SparkplugMetric => ({
  name,
  placeholder: false,
  typeName: "Double",
  value: "1",
  valueRaw: "1",
  lastSeenMs: 0,
  topic: "t",
  ...over,
});

const node = (name: string, over: Partial<SparkplugNode> = {}): SparkplugNode => ({
  group: "G",
  name,
  status: "online",
  online: true,
  seqOk: true,
  metricCount: 2,
  lastSeenMs: 0,
  hasBirth: true,
  verified: true,
  metrics: [metric("a"), metric("b")],
  devices: [],
  placeholderCount: 0,
  storm: false,
  ...over,
});

const groups = (): SparkplugGroup[] => [
  { name: "G", nodes: [node("healthy"), node("gap", { seqOk: false })] },
  { name: "H", nodes: [node("other")] },
];

const kinds = (rows: ReturnType<typeof buildSparkplugTree>) =>
  rows.map((r) => `${r.kind}:${r.metric?.name ?? r.node?.name ?? r.group?.name}`);

const base = {
  expansion: new Map<string, boolean>(),
  defaultExpanded: true,
  filter: "",
  problemsOnly: false,
};

describe("buildSparkplugTree", () => {
  it("opens groups and follows the default for nodes", () => {
    const open = buildSparkplugTree({ ...base, groups: groups() });
    expect(open.filter((r) => r.kind === "metric")).toHaveLength(6);
    const closed = buildSparkplugTree({ ...base, groups: groups(), defaultExpanded: false });
    expect(kinds(closed)).toEqual([
      "group:G",
      "node:healthy",
      "node:gap",
      "group:H",
      "node:other",
    ]);
  });

  it("lets a click override the default per key", () => {
    const rows = buildSparkplugTree({
      ...base,
      groups: groups(),
      defaultExpanded: false,
      expansion: new Map([
        ["G/gap", true],
        ["H", false],
      ]),
    });
    expect(kinds(rows)).toEqual([
      "group:G",
      "node:healthy",
      "node:gap",
      "metric:a",
      "metric:b",
      "group:H",
    ]);
  });

  it("opens everything while filtering so matches are never hidden", () => {
    const rows = buildSparkplugTree({
      ...base,
      groups: groups(),
      defaultExpanded: false,
      expansion: new Map([["G", false]]),
      filter: "b",
    });
    expect(kinds(rows)).toEqual([
      "group:G",
      "node:healthy",
      "metric:b",
      "node:gap",
      "metric:b",
      "group:H",
      "node:other",
      "metric:b",
    ]);
  });

  it("drops groups and nodes with nothing matching", () => {
    const rows = buildSparkplugTree({ ...base, groups: groups(), filter: "other" });
    expect(kinds(rows)).toEqual(["group:H", "node:other", "metric:a", "metric:b"]);
  });

  it("shows only nodes with problems, dropping empty groups", () => {
    const rows = buildSparkplugTree({ ...base, groups: groups(), problemsOnly: true });
    expect(kinds(rows)).toEqual(["group:G", "node:gap", "metric:a", "metric:b"]);
  });
});

describe("nodeProblems and needsRebirth", () => {
  it("lists what needs attention", () => {
    expect(nodeProblems(node("n"))).toEqual([]);
    expect(nodeProblems(node("n", { status: "offline", storm: true }))).toEqual([
      "offline",
      "rebirth storm",
    ]);
    expect(nodeProblems(node("n", { placeholderCount: 2, hasBirth: false }))).toEqual([
      "unresolved aliases",
    ]);
    expect(nodeProblems(node("n", { verified: false }))).toEqual(["names unverified"]);
  });

  it("offers a rebirth for unresolved or unverified live nodes only", () => {
    expect(needsRebirth(node("n"))).toBe(false);
    expect(needsRebirth(node("n", { placeholderCount: 1, hasBirth: false }))).toBe(true);
    expect(needsRebirth(node("n", { verified: false }))).toBe(true);
    expect(needsRebirth(node("n", { verified: false, status: "offline" }))).toBe(false);
  });
});

describe("helpers", () => {
  it("counts metrics and lists every expandable key", () => {
    expect(totalMetricCount(groups())).toBe(6);
    expect(allExpansionKeys(groups())).toEqual(["G", "G/healthy", "G/gap", "H", "H/other"]);
  });

  it("includes units in the copied metric list", () => {
    const json = JSON.parse(metricListJson(node("n", { metrics: [metric("v", { unit: "V" })] })));
    expect(json).toEqual([{ name: "v", type: "Double", value: "1", unit: "V" }]);
  });
});
