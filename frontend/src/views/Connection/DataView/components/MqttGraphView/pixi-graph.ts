// PixiJS renderer for the Topic Graph. Framework-agnostic — instantiated by the
// Svelte wrapper and the dev harness. See docs/topic-graph-view-spec.md §8.
//
// Node = a Sprite of a shared white circle, scaled by EWMA rate and tinted by
// recency (cooldown). Tint/scale update every frame (cheap on the GPU); layout
// recomputes only on structural change. Pan = drag, zoom = wheel.

import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import {
  COLD_ENDPOINT_DARK,
  radiusForScore,
  tintForAge,
  type RGB,
} from "./cooldown";
import { layoutTopicTree, type SortKey } from "./tidy-layout";
import { TopicModel, TopicNode } from "./topic-model";

const TEX_R = 64; // circle texture radius; sprites scale down from this

export interface GraphCallbacks {
  onSelect?: (topic: string) => void;
  onToggle?: (node: TopicNode) => void;
}

export interface GraphOptions {
  rowH?: number;
  colW?: number;
  cooldownMs?: number;
  rMin?: number;
  rMax?: number;
  k?: number;
}

interface NodeVisual {
  container: Container;
  circle: Sprite;
  label: Text;
  caret: Graphics | null;
  badge: Text | null;
  node: TopicNode;
  expanded: boolean;
}

export class TopicGraphRenderer {
  app = new Application();
  private model: TopicModel;
  private world = new Container();
  private edgeLayer = new Graphics();
  private nodeLayer = new Container();
  private selectionRing = new Graphics();
  private circleTex!: Texture;
  private visuals = new Map<string, NodeVisual>();
  private cb: GraphCallbacks;

  rowH = 34;
  colW = 240;
  cooldownMs = 60000;
  rMin = 4;
  rMax = 22;
  k = 3.0;

  private endpoint: RGB = COLD_ENDPOINT_DARK;
  private textColor = 0xbdb7b0;
  private sortKey: SortKey = "rate";
  private filter = "";
  private selected: string | null = null;

  private dragging = false;
  private dragMoved = false;
  private lastPointer = { x: 0, y: 0 };
  private relayoutQueued = false;
  private lastTopicCount = -1;
  private contentW = 0;
  private contentH = 0;

  constructor(model: TopicModel, cb: GraphCallbacks = {}, opts: GraphOptions = {}) {
    this.model = model;
    this.cb = cb;
    Object.assign(this, opts);
  }

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.app.init({
      canvas,
      width,
      height,
      antialias: true,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    const g = new Graphics().circle(0, 0, TEX_R).fill(0xffffff);
    this.circleTex = this.app.renderer.generateTexture(g);
    g.destroy();

    this.world.addChild(this.edgeLayer);
    this.world.addChild(this.selectionRing);
    this.world.addChild(this.nodeLayer);
    this.app.stage.addChild(this.world);
    this.world.position.set(60, height / 2);

    this.installPanZoom(canvas);
    this.app.ticker.add(() => this.frame());
  }

  setEndpoint(rgb: RGB): void {
    this.endpoint = rgb;
  }
  setTextColor(hex: number): void {
    this.textColor = hex;
    for (const v of this.visuals.values()) {
      v.label.style.fill = hex;
      if (v.badge) v.badge.style.fill = hex;
    }
  }
  setSort(key: SortKey): void {
    this.sortKey = key;
    this.relayout();
  }
  setFilter(q: string): void {
    this.filter = q;
    this.relayout();
  }
  setSelected(topic: string | null): void {
    this.selected = topic;
  }

  expandToDepth(depth: number): void {
    this.model.autoExpandDepth = depth;
    const walk = (n: TopicNode) => {
      if (n !== this.model.root) n.expanded = n.depth < depth;
      n.children.forEach(walk);
    };
    this.model.root.children.forEach(walk);
    this.relayout();
  }

  // call after ingesting messages; cheaply relayouts only if the topic set grew
  notifyData(): void {
    if (this.model.topicCount !== this.lastTopicCount) {
      this.scheduleRelayout();
    }
  }

  scheduleRelayout(): void {
    if (this.relayoutQueued) return;
    this.relayoutQueued = true;
    setTimeout(() => {
      this.relayoutQueued = false;
      this.relayout();
    }, 250);
  }

  private installPanZoom(canvas: HTMLCanvasElement): void {
    canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const before = this.world.toLocal({ x: px, y: py });
        this.world.scale.x *= factor;
        this.world.scale.y *= factor;
        this.world.scale.x = Math.max(0.1, Math.min(4, this.world.scale.x));
        this.world.scale.y = this.world.scale.x;
        const after = this.world.toLocal({ x: px, y: py });
        this.world.position.x += (after.x - before.x) * this.world.scale.x;
        this.world.position.y += (after.y - before.y) * this.world.scale.y;
      },
      { passive: false }
    );

    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointerdown", (e: any) => {
      this.dragging = true;
      this.dragMoved = false;
      this.lastPointer = { x: e.global.x, y: e.global.y };
    });
    this.app.stage.on("pointerup", () => {
      this.dragging = false;
    });
    this.app.stage.on("pointerupoutside", () => {
      this.dragging = false;
    });
    this.app.stage.on("pointermove", (e: any) => {
      if (!this.dragging) return;
      const dx = e.global.x - this.lastPointer.x;
      const dy = e.global.y - this.lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
      this.world.position.x += dx;
      this.world.position.y += dy;
      this.lastPointer = { x: e.global.x, y: e.global.y };
    });
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.app.stage.hitArea = this.app.screen;
  }

  // Fit the current content into the viewport, top-aligned below `topMargin`.
  fitView(topMargin = 16): void {
    const vw = this.app.screen.width;
    const vh = this.app.screen.height;
    if (vw <= 0 || vh <= 0) return;
    const cw = Math.max(1, this.contentW + this.colW); // room for labels on the last column
    const ch = Math.max(1, this.contentH + this.rMax * 2);
    const scale = Math.max(0.12, Math.min(1.4, Math.min((vw - 80) / cw, (vh - topMargin - 40) / ch)));
    this.world.scale.set(scale);
    this.world.position.set(40, topMargin + this.rMax * scale);
  }

  relayout(): void {
    const nowMs = Date.now();
    this.lastTopicCount = this.model.topicCount;
    const res = layoutTopicTree(this.model, {
      rowH: this.rowH,
      colW: this.colW,
      sortKey: this.sortKey,
      nowMs,
      filter: this.filter,
    });
    this.contentW = res.width;
    this.contentH = res.height;

    const seen = new Set<string>();
    for (const pn of res.nodes) {
      seen.add(pn.node.topic);
      let v = this.visuals.get(pn.node.topic);
      if (!v) v = this.createVisual(pn.node);
      v.expanded = pn.expanded;
      v.container.position.set(pn.x, pn.y);
      this.updateCaretAndBadge(v);
    }
    // remove visuals no longer present
    for (const [topic, v] of this.visuals) {
      if (!seen.has(topic)) {
        v.container.destroy({ children: true });
        this.visuals.delete(topic);
      }
    }

    // redraw edges (orthogonal elbows)
    this.edgeLayer.clear();
    for (const e of res.edges) {
      const midX = e.x2 - 18;
      this.edgeLayer
        .moveTo(e.x1, e.y1)
        .lineTo(midX, e.y1)
        .lineTo(midX, e.y2)
        .lineTo(e.x2, e.y2);
    }
    this.edgeLayer.stroke({ width: 1.25, color: 0x8a8a8a, alpha: 0.28 });
  }

  private createVisual(node: TopicNode): NodeVisual {
    const container = new Container();
    container.eventMode = "static";

    const circle = new Sprite(this.circleTex);
    circle.anchor.set(0.5);
    circle.eventMode = "static";
    circle.cursor = "pointer";
    circle.on("pointertap", () => {
      if (this.dragMoved) return;
      this.cb.onSelect?.(node.topic);
    });
    container.addChild(circle);

    const label = new Text({
      text: node.name || node.topic,
      style: {
        fill: this.textColor,
        fontSize: 12,
        fontFamily: "Inter, system-ui, sans-serif",
      },
    });
    label.anchor.set(0, 0.5);
    container.addChild(label);

    const v: NodeVisual = { container, circle, label, caret: null, badge: null, node, expanded: node.expanded };
    this.nodeLayer.addChild(container);
    this.visuals.set(node.topic, v);
    return v;
  }

  private updateCaretAndBadge(v: NodeVisual): void {
    const hasChildren = v.node.children.size > 0;
    // caret (toggles expand) for nodes with children
    if (hasChildren && !v.caret) {
      const caret = new Graphics();
      caret.eventMode = "static";
      caret.cursor = "pointer";
      caret.on("pointertap", () => {
        if (this.dragMoved) return;
        v.node.expanded = !v.node.expanded;
        this.cb.onToggle?.(v.node);
        this.relayout();
      });
      v.caret = caret;
      v.container.addChildAt(caret, 0);
    }
    if (v.caret) {
      v.caret.clear();
      const open = v.expanded;
      // small triangle pointing right (collapsed) / down (open), left of the node
      const cx = -16;
      if (open) v.caret.poly([cx - 4, -3, cx + 4, -3, cx, 3]);
      else v.caret.poly([cx - 3, -4, cx - 3, 4, cx + 3, 0]);
      v.caret.fill({ color: 0x8a8a8a, alpha: 0.8 });
    }

    // +N badge for collapsed nodes with descendants
    const showBadge = !v.expanded && v.node.descendantCount > 0;
    if (showBadge && !v.badge) {
      v.badge = new Text({
        text: "",
        style: { fill: this.textColor, fontSize: 10, fontFamily: "Inter, system-ui, sans-serif" },
      });
      v.badge.anchor.set(0, 0.5);
      v.container.addChild(v.badge);
    }
    if (v.badge) {
      v.badge.visible = showBadge;
      if (showBadge) v.badge.text = `+${v.node.descendantCount}`;
    }
  }

  private frame(): void {
    const nowMs = Date.now();
    const showLabels = this.world.scale.x >= 0.55;
    for (const v of this.visuals.values()) {
      const score = v.expanded
        ? this.model.ownScore(v.node, nowMs)
        : this.model.aggScore(v.node, nowMs);
      const lastMsg = v.expanded ? v.node.ownLastMsg : v.node.aggLastMsg;
      const r = radiusForScore(score, this.rMin, this.rMax, this.k);
      v.circle.scale.set(r / TEX_R);
      const age = lastMsg === 0 ? this.cooldownMs * 2 : nowMs - lastMsg;
      v.circle.tint = tintForAge(age, this.cooldownMs, this.endpoint);

      v.label.x = r + 7;
      v.label.visible = showLabels;
      if (v.badge && v.badge.visible) {
        v.badge.x = r + 9 + v.label.width + 8;
        v.badge.visible = showLabels;
      }
    }

    // selection ring
    this.selectionRing.clear();
    if (this.selected) {
      const v = this.visuals.get(this.selected);
      if (v) {
        const r = v.circle.width / 2;
        this.selectionRing.circle(v.container.x, v.container.y, r + 5);
        this.selectionRing.stroke({ width: 2, color: 0xece9e7, alpha: 0.9 });
      }
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
    this.visuals.clear();
  }
}
