// Topic hierarchy model for the Topic Graph view.
// Ingests a stream of topic arrivals and maintains, per node:
//   own.*  — this exact topic's traffic (shown when the node is EXPANDED)
//   agg.*  — the whole subtree's traffic (shown when the node is COLLAPSED)
// See docs/topic-graph-view-spec.md §4 (single-core, state-dependent) and §9.

import { bumpScore, decayScore, type DecayScore } from "./cooldown";

export class TopicNode {
  name: string; // this level's segment, e.g. "temperature"
  topic: string; // full path, e.g. "house/livingroom/temperature"
  depth: number; // 0 = top-level topic
  parent: TopicNode | null;
  children = new Map<string, TopicNode>();

  // expanded: are this node's children shown? collapsed nodes render the subtree aggregate.
  expanded = false;

  // own traffic (messages published on exactly this topic)
  own: DecayScore = { score: 0, lastMs: 0 };
  ownLastMsg = 0;
  ownCount = 0;

  // subtree aggregate (this node + all descendants)
  agg: DecayScore = { score: 0, lastMs: 0 };
  aggLastMsg = 0;

  descendantCount = 0; // number of topic nodes strictly below this one

  constructor(name: string, topic: string, depth: number, parent: TopicNode | null) {
    this.name = name;
    this.topic = topic;
    this.depth = depth;
    this.parent = parent;
  }

  get isLeaf(): boolean {
    return this.children.size === 0;
  }
}

export class TopicModel {
  // synthetic root; its children are the top-level topics (no broker hub is drawn)
  root = new TopicNode("", "", -1, null);
  tauMs: number;
  // nodes shallower than this auto-expand when first discovered
  autoExpandDepth = 1;
  private nodeCount = 0;

  constructor(tauMs = 14000) {
    this.tauMs = tauMs;
  }

  get topicCount(): number {
    return this.nodeCount;
  }

  clear(): void {
    this.root = new TopicNode("", "", -1, null);
    this.nodeCount = 0;
  }

  // Record a message arrival on `topic` at time `tMs`.
  ingest(topic: string, tMs: number): void {
    const levels = topic.split("/");
    let node = this.root;
    for (let i = 0; i < levels.length; i++) {
      const seg = levels[i];
      let child = node.children.get(seg);
      if (!child) {
        const full = levels.slice(0, i + 1).join("/");
        child = new TopicNode(seg, full, i, node);
        child.expanded = i < this.autoExpandDepth;
        node.children.set(seg, child);
        this.nodeCount++;
        // every ancestor gains a descendant
        for (let p = node; p && p !== this.root; p = p.parent!) p.descendantCount++;
      }
      node = child;
      // each node on the path accumulates the subtree aggregate
      bumpScore(node.agg, tMs, this.tauMs);
      node.aggLastMsg = tMs;
    }
    // the exact topic node accumulates its own traffic
    bumpScore(node.own, tMs, this.tauMs);
    node.ownLastMsg = tMs;
    node.ownCount++;
  }

  // current subtree rate-score, decayed to now
  aggScore(node: TopicNode, nowMs: number): number {
    return decayScore(node.agg, nowMs, this.tauMs);
  }

  // current own rate-score, decayed to now
  ownScore(node: TopicNode, nowMs: number): number {
    return decayScore(node.own, nowMs, this.tauMs);
  }
}
