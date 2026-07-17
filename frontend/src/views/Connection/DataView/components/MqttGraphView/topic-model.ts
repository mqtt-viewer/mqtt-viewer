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

  // does this exact topic hold a retained message, as far as we know? Drives
  // the retained marker only; the backend is authoritative for counting and
  // clearing. Never aggregated up the tree: retained is a property of the
  // topic a message was published to, not of its ancestors.
  ownRetained = false;

  // subtree aggregate (this node + all descendants)
  agg: DecayScore = { score: 0, lastMs: 0 };
  aggLastMsg = 0;
  aggCount = 0; // total messages seen in the subtree

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
  // nodes shallower than this auto-expand when first discovered. 0 = start
  // fully collapsed: only top-level topics visible, each showing its subtree
  // aggregate. A busy broker has far too many second-level nodes for
  // depth 1 to be a sane default; the user drills in from the roots.
  autoExpandDepth = 0;
  private nodeCount = 0;

  // Set whenever a change could alter the LAID-OUT (visible) tree: a new node
  // arriving under an expanded ancestor chain, a removal, or an expansion
  // toggle. Collapsed-subtree arrivals do NOT set this — they only update
  // counters/badges, which the slow tick picks up without a relayout. Callers
  // that schedule relayouts should check-and-clear this flag rather than
  // topicCount, so the debounce is a no-op when nothing visible changed.
  visibleDirty = false;

  // Bumped every time the set of nodes eligible to appear in the layout
  // changes shape: a node is added/removed, or an expansion toggle flips which
  // subtrees are reachable. Positions alone (score-driven sort order) do not
  // bump this. Used by the renderer to skip edge-array rebuilds when only
  // positions moved.
  structureGen = 0;

  constructor(tauMs = 14000) {
    this.tauMs = tauMs;
  }

  get topicCount(): number {
    return this.nodeCount;
  }

  clear(): void {
    this.root = new TopicNode("", "", -1, null);
    this.nodeCount = 0;
    this.visibleDirty = true;
    this.structureGen++;
  }

  // true if every ancestor up to (but not including) the synthetic root is
  // expanded — i.e. `node` would actually be reachable by the layout's
  // childrenAccessor. The node itself need not be expanded to appear.
  private isVisibleInTree(node: TopicNode): boolean {
    for (let p = node.parent; p && p !== this.root; p = p.parent) {
      if (!p.expanded) return false;
    }
    return true;
  }

  // Mark a toggled node's visibility state dirty (expand/collapse always
  // changes the laid-out tree, whether it reveals or hides a subtree).
  markExpansionChanged(): void {
    this.visibleDirty = true;
    this.structureGen++;
  }

  /**
   * Record a message arrival on `topic` at time `tMs`.
   *
   * `retained` says what the message implies about the topic's retained state:
   * true if it carries a retained value, false if it is the zero-length
   * retained tombstone that clears one, and undefined if it says nothing (an
   * ordinary message). Mirrors the rule the backend applies.
   */
  ingest(topic: string, tMs: number, retained?: boolean): void {
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
        // only a node reachable under a fully-expanded ancestor chain can
        // change what the layout actually draws; a new node buried under a
        // collapsed ancestor is invisible until that ancestor expands, at
        // which point expandToDepth/the caret toggle marks things dirty itself
        if (this.isVisibleInTree(child)) {
          this.visibleDirty = true;
          this.structureGen++;
        }
      }
      node = child;
      // each node on the path accumulates the subtree aggregate
      bumpScore(node.agg, tMs, this.tauMs);
      node.aggLastMsg = tMs;
      node.aggCount++;
    }
    // the exact topic node accumulates its own traffic
    bumpScore(node.own, tMs, this.tauMs);
    node.ownLastMsg = tMs;
    node.ownCount++;
    if (retained !== undefined) node.ownRetained = retained;
  }

  // current subtree rate-score, decayed to now
  aggScore(node: TopicNode, nowMs: number): number {
    return decayScore(node.agg, nowMs, this.tauMs);
  }

  // current own rate-score, decayed to now
  ownScore(node: TopicNode, nowMs: number): number {
    return decayScore(node.own, nowMs, this.tauMs);
  }

  // Read-only variant of aggScore: returns the subtree rate decayed to `nowMs`
  // WITHOUT mutating node.agg.lastMs/score. Used by the layout's sort pass,
  // which must compute many nodes' scores per pass without perturbing the
  // live decay state that aggScore's mutating read maintains for every other
  // caller (hover inspector, per-frame radius/tint, etc).
  peekAggScore(node: TopicNode, nowMs: number): number {
    const s = node.agg;
    if (s.lastMs === 0) return s.score;
    const dt = nowMs - s.lastMs;
    if (dt <= 0) return s.score;
    return s.score * Math.exp(-dt / this.tauMs);
  }
}
