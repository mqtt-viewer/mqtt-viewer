import { expect, test } from "vitest";
import { TopicModel } from "./topic-model";

test("ingest of a brand-new top-level topic marks visibleDirty", () => {
  const model = new TopicModel();
  expect(model.visibleDirty).toBe(false);
  model.ingest("a/b", 1000);
  expect(model.visibleDirty).toBe(true);
});

test("ingest under a collapsed ancestor does not mark visibleDirty", () => {
  const model = new TopicModel();
  // autoExpandDepth defaults to 1, so depth-0 nodes auto-expand but their
  // children (depth 1+) start collapsed
  model.ingest("a/b", 1000);
  model.visibleDirty = false;
  model.structureGen = 0;

  // "a" is expanded (depth 0 < autoExpandDepth 1) but "b" (depth 1) is not,
  // so a new grandchild under "a/b" sits under a collapsed ancestor and can't
  // appear in the laid-out tree
  model.ingest("a/b/c", 1001);
  expect(model.visibleDirty).toBe(false);
  expect(model.structureGen).toBe(0);
  // counters still update even though the layout wasn't marked dirty
  const a = model.root.children.get("a")!;
  expect(a.descendantCount).toBe(2);
});

test("ingest under a collapsed ancestor still updates counters/aggregates", () => {
  const model = new TopicModel();
  model.ingest("a/b", 1000);
  const b = model.root.children.get("a")!.children.get("b")!;
  expect(b.expanded).toBe(false); // depth 1 >= autoExpandDepth 1

  model.visibleDirty = false;
  model.ingest("a/b/c", 1001);
  // aggCount on "b" (the collapsed ancestor) reflects the new arrival
  expect(b.aggCount).toBe(2);
  expect(b.descendantCount).toBe(1);
  expect(model.visibleDirty).toBe(false);
});

test("expanding a previously-collapsed node whose subtree already exists marks dirty via markExpansionChanged", () => {
  const model = new TopicModel();
  model.ingest("a/b/c", 1000);
  const b = model.root.children.get("a")!.children.get("b")!;
  model.visibleDirty = false;

  b.expanded = true;
  model.markExpansionChanged();
  expect(model.visibleDirty).toBe(true);
});

test("ingest after ancestor expands marks visibleDirty again", () => {
  const model = new TopicModel();
  model.ingest("a/b/c", 1000);
  // the graph now starts fully collapsed (autoExpandDepth 0), so the whole
  // ancestor chain must be expanded explicitly for a new arrival to be visible
  const a = model.root.children.get("a")!;
  const b = a.children.get("b")!;
  a.expanded = true;
  b.expanded = true;
  model.visibleDirty = false;

  // now a new child under the now-expanded "b" is reachable
  model.ingest("a/b/d", 1001);
  expect(model.visibleDirty).toBe(true);
});

test("structureGen only bumps on structural change, not on repeated ingests of existing topics", () => {
  const model = new TopicModel();
  model.ingest("a/b", 1000);
  const genAfterFirst = model.structureGen;
  // second message on the SAME topic: no new node created
  model.ingest("a/b", 1001);
  expect(model.structureGen).toBe(genAfterFirst);
});

test("peekAggScore does not mutate node.agg, unlike aggScore", () => {
  const model = new TopicModel();
  model.ingest("a", 1000);
  const a = model.root.children.get("a")!;
  const aggBefore = { ...a.agg };

  const peeked = model.peekAggScore(a, 5000);
  expect(a.agg).toEqual(aggBefore); // untouched

  const mutatingScore = model.aggScore(a, 5000);
  expect(mutatingScore).toBeCloseTo(peeked, 10);
  expect(a.agg.lastMs).toBe(5000); // aggScore DID advance the decay clock
});

test("peekAggScore matches aggScore's decay math at a later read time", () => {
  const model = new TopicModel(14000);
  model.ingest("a", 0);
  model.ingest("a", 0); // score bumped twice at t=0
  const a = model.root.children.get("a")!;

  const nowMs = 7000;
  const peeked = model.peekAggScore(a, nowMs);
  const mutated = model.aggScore(a, nowMs);
  expect(peeked).toBeCloseTo(mutated, 10);
});

test("clear resets nodeCount and marks visibleDirty", () => {
  const model = new TopicModel();
  model.ingest("a/b", 1000);
  model.visibleDirty = false;
  model.clear();
  expect(model.topicCount).toBe(0);
  expect(model.visibleDirty).toBe(true);
});

const SEED_T = 1_700_000_000_000; // realistic epoch-ms base for seed timestamps

test("seedTopic makes aggCount equal the List's cumulative messageCount at every level", () => {
  const model = new TopicModel(14000);
  // Mirrors a MqttData snapshot (subtree-cumulative messageCount):
  //   factory                 messageCount 6 (structural)
  //     factory/line1         messageCount 5 (structural)
  //       factory/line1/temp  messageCount 3  own 3
  //       factory/line1/hum   messageCount 2  own 2
  //     factory/line2/temp    messageCount 1  own 1
  model.seedTopic("factory/line1/temp", 3, SEED_T);
  model.seedTopic("factory/line1/hum", 2, SEED_T);
  model.seedTopic("factory/line2/temp", 1, SEED_T);

  const factory = model.root.children.get("factory")!;
  const line1 = factory.children.get("line1")!;
  const temp1 = line1.children.get("temp")!;
  const hum = line1.children.get("hum")!;
  const line2 = factory.children.get("line2")!;
  const temp2 = line2.children.get("temp")!;

  // aggCount at every level equals that node's cumulative messageCount
  expect(temp1.aggCount).toBe(3);
  expect(hum.aggCount).toBe(2);
  expect(line1.aggCount).toBe(5);
  expect(temp2.aggCount).toBe(1);
  expect(line2.aggCount).toBe(1);
  expect(factory.aggCount).toBe(6);
  // own count lands only on the exact publisher leaves
  expect(temp1.ownCount).toBe(3);
  expect(line1.ownCount).toBe(0);
  expect(factory.ownCount).toBe(0);
  // recency propagates to interior ancestors for stale/newest sorts
  expect(factory.aggLastMsg).toBe(SEED_T);
  expect(line1.aggLastMsg).toBe(SEED_T);
});

test("seedTopic without a rate seeds score 0 (no phantom bump) with the real lastMs", () => {
  const model = new TopicModel(14000);
  model.seedTopic("idle/topic", 1, SEED_T); // no rate supplied
  const leaf = model.root.children.get("idle")!.children.get("topic")!;
  // ingest() would leave score 1 here; seedTopic must add NO phantom bump so an
  // hour-idle topic doesn't seed hot
  expect(leaf.agg.score).toBe(0);
  expect(leaf.own.score).toBe(0);
  // ...but the real last-message time is preserved, not the uninitialised 0
  expect(leaf.agg.lastMs).toBe(SEED_T);
  expect(leaf.own.lastMs).toBe(SEED_T);
  expect(leaf.aggLastMsg).toBe(SEED_T);
});

test("seedTopic copies the List rate into agg and own for a leaf, by value", () => {
  const model = new TopicModel(14000);
  const rate = { score: 4.2, lastMs: SEED_T };
  model.seedTopic("sensor/temp", 5, SEED_T, rate);
  const leaf = model.root.children.get("sensor")!.children.get("temp")!;
  expect(leaf.agg.score).toBe(4.2);
  expect(leaf.own.score).toBe(4.2);
  // copied by value: the List keeps mutating its own DecayScore object
  rate.score = 999;
  expect(leaf.agg.score).toBe(4.2);
  expect(leaf.own.score).toBe(4.2);
});

test("seedTopic does not copy the subtree rate into own for a non-leaf publisher", () => {
  const model = new TopicModel(14000);
  // seed the child first so the parent is a non-leaf when it is seeded
  model.seedTopic("parent/child", 2, SEED_T, { score: 1, lastMs: SEED_T });
  model.seedTopic("parent", 3, SEED_T, { score: 9, lastMs: SEED_T });
  const parent = model.root.children.get("parent")!;
  expect(parent.isLeaf).toBe(false);
  // agg (the subtree aggregate) takes the copied rate; own is left at 0 for
  // live traffic to fill, since the List rate is a subtree figure not own
  expect(parent.agg.score).toBe(9);
  expect(parent.own.score).toBe(0);
  // counts stay exact regardless
  expect(parent.ownCount).toBe(3);
  expect(parent.aggCount).toBe(5); // 3 own + 2 from child
});
