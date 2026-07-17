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

test("retained: marks the exact topic, never its ancestors", () => {
  const m = new TopicModel();
  m.ingest("a/b/c", 1000, true);
  const c = m.root.children.get("a")!.children.get("b")!.children.get("c")!;
  expect(c.ownRetained).toBe(true);
  expect(m.root.children.get("a")!.ownRetained).toBe(false);
  expect(m.root.children.get("a")!.children.get("b")!.ownRetained).toBe(false);
});

test("retained: a tombstone clears the mark", () => {
  const m = new TopicModel();
  m.ingest("a", 1000, true);
  m.ingest("a", 2000, false);
  expect(m.root.children.get("a")!.ownRetained).toBe(false);
});

test("retained: an ordinary message leaves the mark alone", () => {
  const m = new TopicModel();
  m.ingest("a", 1000, true);
  m.ingest("a", 2000);
  expect(m.root.children.get("a")!.ownRetained).toBe(true);
});
