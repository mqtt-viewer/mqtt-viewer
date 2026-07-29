import { expect, test } from "vitest";
import { coerceSortKey, layoutTopicTree } from "./tidy-layout";
import { TopicModel } from "./topic-model";

const baseOpts = { rowH: 34, colW: 240, nowMs: 10000 };
const T = 1_700_000_000_000; // realistic epoch-ms base for test timestamps

test("rate-sorted layout does not mutate node.agg decay state", () => {
  const model = new TopicModel(14000);
  model.ingest("a", 0);
  model.ingest("b", 0);
  model.ingest("b", 0); // "b" busier than "a"
  model.root.children.forEach((n) => (n.expanded = true));

  const a = model.root.children.get("a")!;
  const b = model.root.children.get("b")!;
  const aggBefore = { a: { ...a.agg }, b: { ...b.agg } };

  layoutTopicTree(model, { ...baseOpts, sortKey: "rate" });

  expect(a.agg).toEqual(aggBefore.a);
  expect(b.agg).toEqual(aggBefore.b);
});

test("rate sort still orders busier topics first, matching decayed score order", () => {
  const model = new TopicModel(14000);
  model.ingest("quiet", 0);
  model.ingest("busy", 0);
  model.ingest("busy", 0);
  model.ingest("busy", 0);

  const res = layoutTopicTree(model, { ...baseOpts, sortKey: "rate" });
  const order = res.nodes
    .filter((pn) => pn.node.depth === 0)
    .sort((x, y) => x.y - y.y)
    .map((pn) => pn.node.name);
  expect(order).toEqual(["busy", "quiet"]);
});

test("repeated layout calls at the same nowMs are idempotent for rate sort", () => {
  const model = new TopicModel(14000);
  model.ingest("a", T);
  model.ingest("b", T);
  model.ingest("b", T);

  const first = layoutTopicTree(model, { ...baseOpts, nowMs: T, sortKey: "rate" });
  const second = layoutTopicTree(model, { ...baseOpts, nowMs: T, sortKey: "rate" });
  expect(second.nodes.map((n) => n.node.topic)).toEqual(
    first.nodes.map((n) => n.node.topic)
  );
});

test("msgs sort orders topics by descending subtree message count", () => {
  const model = new TopicModel(14000);
  model.ingest("a", T); // aggCount 1
  model.ingest("b", T);
  model.ingest("b", T);
  model.ingest("b", T); // aggCount 3
  model.ingest("c", T);
  model.ingest("c", T); // aggCount 2

  const res = layoutTopicTree(model, { ...baseOpts, nowMs: T, sortKey: "msgs" });
  const order = res.nodes
    .filter((pn) => pn.node.depth === 0)
    .sort((x, y) => x.y - y.y)
    .map((pn) => pn.node.name);
  expect(order).toEqual(["b", "c", "a"]);
});

test("equal-rate siblings are ordered alphabetically (deterministic tie-break)", () => {
  const model = new TopicModel(14000);
  // three siblings that all published exactly once at the same instant: equal
  // decayed rate, so the tie-break by name (A -> Z) must decide the order
  model.ingest("charlie", T);
  model.ingest("alpha", T);
  model.ingest("bravo", T);

  const res = layoutTopicTree(model, { ...baseOpts, nowMs: T, sortKey: "rate" });
  const order = res.nodes
    .filter((pn) => pn.node.depth === 0)
    .sort((x, y) => x.y - y.y)
    .map((pn) => pn.node.name);
  expect(order).toEqual(["alpha", "bravo", "charlie"]);
});

test("wildcard filter keeps the matching branch and prunes non-matching siblings", () => {
  const model = new TopicModel(14000);
  model.ingest("factory/line1/temp", T);
  model.ingest("factory/line1/humidity", T);
  model.ingest("factory/line2/temp", T);
  model.ingest("warehouse/line1/temp", T);

  const res = layoutTopicTree(model, {
    ...baseOpts,
    nowMs: T,
    sortKey: "alpha",
    filter: "factory/+/temp",
  });
  const topics = new Set(res.nodes.map((pn) => pn.node.topic));

  // matching leaves kept
  expect(topics.has("factory/line1/temp")).toBe(true);
  expect(topics.has("factory/line2/temp")).toBe(true);
  // interior nodes kept via a matching descendant, even though the interior
  // path itself does NOT wildcard-match "factory/+/temp" (A5: intermediate
  // node retained by the keep-set, not by matching the pattern directly)
  expect(topics.has("factory")).toBe(true);
  expect(topics.has("factory/line1")).toBe(true);
  expect(topics.has("factory/line2")).toBe(true);
  // sibling leaf that doesn't match the pattern is pruned
  expect(topics.has("factory/line1/humidity")).toBe(false);
  // unrelated top-level branch pruned entirely
  expect(topics.has("warehouse")).toBe(false);
  expect(topics.has("warehouse/line1/temp")).toBe(false);
});

test("coerceSortKey falls back to rate for legacy-missing and garbage values", () => {
  // legacy settings blob predates sortKey persistence -> s.sortKey undefined
  expect(coerceSortKey(undefined)).toBe("rate");
  // corrupt / unknown strings and non-strings never reach the comparators
  expect(coerceSortKey("bogus")).toBe("rate");
  expect(coerceSortKey(42)).toBe("rate");
  expect(coerceSortKey(null)).toBe("rate");
  // every valid key passes through unchanged
  expect(coerceSortKey("rate")).toBe("rate");
  expect(coerceSortKey("msgs")).toBe("msgs");
  expect(coerceSortKey("recency")).toBe("recency");
  expect(coerceSortKey("stale")).toBe("stale");
  expect(coerceSortKey("alpha")).toBe("alpha");
  expect(coerceSortKey("count")).toBe("count");
});
