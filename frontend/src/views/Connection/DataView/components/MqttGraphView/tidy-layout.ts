// Deterministic horizontal tidy-tree layout (Reingold–Tilford via d3-hierarchy).
// Roots stack vertically; children fan right on a fixed depth-column x row grid.
// See docs/topic-graph-view-spec.md §3.

import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import { TopicModel, TopicNode } from "./topic-model";

export type SortKey = "rate" | "recency" | "alpha" | "count";

export interface LayoutOptions {
  rowH: number;
  colW: number;
  sortKey: SortKey;
  nowMs: number;
  filter?: string; // when set, prune to matching subtrees and force-expand them
}

export interface PlacedNode {
  node: TopicNode;
  x: number; // horizontal (depth)
  y: number; // vertical (breadth)
  /** effective: is this node showing its own traffic (expanded) vs subtree aggregate (collapsed)? */
  expanded: boolean;
}

export interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LayoutResult {
  nodes: PlacedNode[];
  edges: Edge[];
  width: number;
  height: number;
}

function matches(node: TopicNode, q: string): boolean {
  return node.topic.toLowerCase().includes(q);
}

// returns true if node or any descendant matches the query
function buildKeepSet(node: TopicNode, q: string, keep: Set<TopicNode>): boolean {
  let any = matches(node, q);
  for (const child of node.children.values()) {
    if (buildKeepSet(child, q, keep)) any = true;
  }
  if (any) keep.add(node);
  return any;
}

export function layoutTopicTree(model: TopicModel, opts: LayoutOptions): LayoutResult {
  const { rowH, colW, sortKey, nowMs } = opts;
  const q = opts.filter?.trim().toLowerCase() ?? "";
  const filtering = q.length > 0;

  const keep = new Set<TopicNode>();
  if (filtering) buildKeepSet(model.root, q, keep);

  const sortValue = (n: TopicNode): number | string => {
    switch (sortKey) {
      case "rate":
        return -model.aggScore(n, nowMs);
      case "recency":
        return -n.aggLastMsg;
      case "count":
        return -(n.descendantCount + n.ownCount);
      case "alpha":
      default:
        return n.name;
    }
  };

  const sortChildren = (n: TopicNode): TopicNode[] => {
    let kids = [...n.children.values()];
    if (filtering) kids = kids.filter((k) => keep.has(k));
    kids.sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb));
      }
      return va - vb;
    });
    return kids;
  };

  // children accessor for d3: collapsed nodes are leaves in the layout.
  // when filtering, kept branches are force-expanded so matches are revealed.
  const childrenAccessor = (n: TopicNode): TopicNode[] | null => {
    if (n === model.root) return sortChildren(n);
    const show = filtering ? keep.has(n) : n.expanded;
    if (!show) return null;
    const kids = sortChildren(n);
    return kids.length ? kids : null;
  };

  const h = hierarchy<TopicNode>(model.root, childrenAccessor);
  const layout = tree<TopicNode>()
    .nodeSize([rowH, colW])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.25));
  const rootPoint = layout(h);

  const all = rootPoint.descendants();
  // d3 assigns .x (breadth) and .y (depth*colW). We render horizontally:
  //   screenX = .y ; screenY = .x . Synthetic root sits one column left and is skipped.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const placed: PlacedNode[] = [];
  const pointByNode = new Map<TopicNode, HierarchyPointNode<TopicNode>>();

  for (const p of all) {
    pointByNode.set(p.data, p);
    if (p.data === model.root) continue;
    const x = p.y - colW; // top-level topics at column 0
    const y = p.x;
    const expanded = filtering ? keep.has(p.data) : p.data.expanded;
    placed.push({ node: p.data, x, y, expanded });
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  if (placed.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  // normalize so the content starts at (0,0)
  const offX = -minX;
  const offY = -minY;
  for (const pn of placed) {
    pn.x += offX;
    pn.y += offY;
  }

  // edges between real nodes (skip links from the synthetic root)
  const edges: Edge[] = [];
  for (const p of all) {
    if (p.data === model.root || !p.parent || p.parent.data === model.root) continue;
    const c = { x: p.y - colW + offX, y: p.x + offY };
    const pa = { x: p.parent.y - colW + offX, y: p.parent.x + offY };
    edges.push({ x1: pa.x, y1: pa.y, x2: c.x, y2: c.y });
  }

  return {
    nodes: placed,
    edges,
    width: maxX - minX,
    height: maxY - minY,
  };
}
