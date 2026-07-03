import { expect, test } from "vitest";
import { layoutTopicTree } from "./tidy-layout";
import { TopicModel } from "./topic-model";

const baseOpts = { rowH: 34, colW: 240, nowMs: 10000 };

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
  model.ingest("a", 0);
  model.ingest("b", 0);
  model.ingest("b", 0);

  const first = layoutTopicTree(model, { ...baseOpts, sortKey: "rate" });
  const second = layoutTopicTree(model, { ...baseOpts, sortKey: "rate" });
  expect(second.nodes.map((n) => n.node.topic)).toEqual(
    first.nodes.map((n) => n.node.topic)
  );
});
