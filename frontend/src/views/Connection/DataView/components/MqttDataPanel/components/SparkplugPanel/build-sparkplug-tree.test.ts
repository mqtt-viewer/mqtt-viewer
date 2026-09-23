import { describe, it, expect } from "vitest";
import {
  allExpansionKeys,
  buildSparkplugTree,
  formatClockTime,
  isSparkplugProtobufTopic,
  metricListJson,
  needsRebirth,
  nodeProblems,
  normaliseFilter,
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
    // Names carried over a drop are offered a rebirth, not counted as a
    // problem: after any blip every node has them.
    expect(nodeProblems(node("n", { verified: false }))).toEqual([]);
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

describe("search", () => {
  const fleet = (): SparkplugGroup[] => [
    {
      name: "Plant",
      nodes: [
        node("edge-1", {
          group: "Plant",
          metrics: [metric("Line 1/Motor/Current"), metric("alias_7", { placeholder: true })],
          devices: [
            {
              name: "plc-12",
              status: "online",
              online: true,
              hasBirth: true,
              verified: true,
              metrics: [metric("Speed")],
              lastSeenMs: 0,
              placeholderCount: 0,
              awaitingBirth: false,
            },
          ],
        }),
        node("edge-2", { group: "Plant" }),
      ],
    },
  ];
  const names = (filter: string) =>
    kinds(buildSparkplugTree({ ...base, groups: fleet(), filter }));

  it("reduces a pasted Sparkplug topic to the tree's path", () => {
    expect(normaliseFilter(" spBv1.0/Plant/NDATA/edge-1 ")).toBe("plant/edge-1");
    expect(normaliseFilter("spBv1.0/Plant/DDATA/edge-1/plc-12")).toBe("plant/edge-1/plc-12");
    expect(normaliseFilter("spBv1.0/Plant")).toBe("plant");
    expect(normaliseFilter("Volts")).toBe("volts");
  });

  it("finds a node by the Group/Node path the warnings print", () => {
    expect(names("Plant/edge-1")).toEqual([
      "group:Plant",
      "node:edge-1",
      "metric:Line 1/Motor/Current",
      "metric:alias_7",
      "device:edge-1",
      "metric:Speed",
    ]);
    expect(names("spBv1.0/Plant/NDATA/edge-2")).toEqual(["group:Plant", "node:edge-2", "metric:a", "metric:b"]);
  });

  it("finds a device by its path and a metric by its full path", () => {
    expect(names("edge-1/plc-12")).toEqual(["group:Plant", "node:edge-1", "device:edge-1", "metric:Speed"]);
    expect(names("edge-1/Line 1/Motor")).toEqual([
      "group:Plant",
      "node:edge-1",
      "metric:Line 1/Motor/Current",
    ]);
  });

  it("finds an unnamed metric by the alias label it shows", () => {
    expect(names("alias 7")).toEqual(["group:Plant", "node:edge-1", "metric:alias_7"]);
  });

  it("gives every row a unique id and its own index", () => {
    const rows = buildSparkplugTree({ ...base, groups: fleet() });
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    rows.forEach((r, i) => expect(r.index).toBe(i));
    // A node metric named like a device's metric path stays distinct.
    const tricky = fleet();
    tricky[0].nodes[0].metrics.push(metric("plc-12/Speed"));
    const trickyRows = buildSparkplugTree({ ...base, groups: tricky });
    expect(new Set(trickyRows.map((r) => r.id)).size).toBe(trickyRows.length);
  });
});

describe("formatClockTime", () => {
  it("adds the date when it isn't today", () => {
    const now = new Date(2026, 8, 23, 12, 0, 0).getTime();
    expect(formatClockTime(new Date(2026, 8, 23, 9, 5, 7).getTime(), now)).toBe("09:05:07");
    expect(formatClockTime(new Date(2026, 8, 20, 22, 2, 58).getTime(), now)).toBe("2026-09-20 22:02:58");
  });
});

describe("isSparkplugProtobufTopic", () => {
  it("covers node and device topics but not host state", () => {
    expect(isSparkplugProtobufTopic("spBv1.0/G/NDATA/n")).toBe(true);
    expect(isSparkplugProtobufTopic("spBv1.0/STATE/scada")).toBe(false);
    expect(isSparkplugProtobufTopic("spAv1.0/G/NDATA/n")).toBe(false);
  });
});
