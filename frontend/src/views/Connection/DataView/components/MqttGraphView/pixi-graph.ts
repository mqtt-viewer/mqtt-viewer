// PixiJS renderer for the Topic Graph. Framework-agnostic — instantiated by the
// Svelte wrapper and the dev harness. See docs/topic-graph-view-spec.md §8.
//
// Node = a Sprite of a shared white circle, scaled by EWMA rate and tinted by
// recency (cooldown). Tint/scale update every frame (cheap on the GPU); layout
// recomputes only on structural change. Pan = drag, zoom = wheel.

import {
  Application,
  Circle,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
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
  /** topic selected, or null when the user clicks the selected node again */
  onSelect?: (topic: string | null) => void;
  onToggle?: (node: TopicNode) => void;
  /** hover enters/moves over a node (screen coords), or leaves (topic = null) */
  onHover?: (topic: string | null, x: number, y: number) => void;
}

export interface ThemeUi {
  text: number;
  accent: number; // selection ring + minimap viewport
  minimapBg: number;
  minimapBgAlpha: number;
  minimapBorder: number;
  pulse: number; // message-arrival ripple stroke colour
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
  label: Text | null; // lazily created/pooled — only exists while visible & labels-on
  caret: Graphics | null;
  caretHover: boolean;
  badge: Text | null; // lazily created/pooled, same lifecycle as label
  node: TopicNode;
  expanded: boolean;
  tx: number; // target x (animated toward)
  ty: number; // target y
  lastRippleMsg: number; // last-rendered message timestamp (for ripple spawn edge-detect)
  culled: boolean; // outside the viewport (+ margin) — skips all per-frame work
  moving: boolean; // still easing toward (tx, ty)
  r: number; // last-computed radius (cached so culled nodes keep a sane value)
}

interface Ripple {
  visual: NodeVisual;
  startMs: number;
}

export class TopicGraphRenderer {
  app = new Application();
  private model: TopicModel;
  private world = new Container();
  private edgeLayer = new Graphics();
  private pulseLayer = new Graphics();
  private nodeLayer = new Container();
  private selectionRing = new Graphics();
  private aggRingLayer = new Graphics(); // outline rings marking collapsed subtree aggregates
  private circleTex!: Texture;
  private visuals = new Map<string, NodeVisual>();
  private cb: GraphCallbacks;

  rowH = 34;
  colW = 240;
  cooldownMs = 60000;
  // size = rMin + k·√(EWMA score). Tuned to the typical score range (idle ~0,
  // a 0.1 msg/s topic ~1.4, ~0.5/s ~7, a busy 2/s leaf ~28, a spike caps out):
  // structural/idle ≈ rMin, mid ≈ 10-12, busy ≈ 16, anything hotter clamps at rMax.
  rMin = 3.5;
  rMax = 20;
  k = 2.4;

  private endpoint: RGB = COLD_ENDPOINT_DARK;
  private textColor = 0xbdb7b0;
  private accentColor = 0x7c8cff; // brand primary (dark theme default)
  private minimapBgColor = 0x000000;
  private minimapBgAlpha = 0.32;
  private minimapBorderColor = 0x8a8a8a;
  private pulseColor = 0xffffff;
  private sortKey: SortKey = "rate";
  private filter = "";
  private selected: string | null = null;
  private cvdSafe = false;
  private followHottest = false;
  private followTarget: string | null = null;

  private edges: Array<[NodeVisual, NodeVisual]> = [];
  private ripples: Ripple[] = [];
  // tree-view flash reference duration (MqttTopicRow.FLASH_DURATION_MS); the
  // canvas ripple runs on the same clock so both views "feel" the same
  private readonly RIPPLE_DURATION_MS = 1200;
  // global cap on live ripples so a busy broker can't pile up unbounded draw calls
  private readonly RIPPLE_CAP = 40;
  private minimap = new Container();
  private minimapBg = new Graphics();
  private minimapDots = new Graphics();
  private minimapView = new Graphics();
  private minimapW = 210;
  private minimapH = 140;
  private minimapVisible = true;
  private lastMinimapDrawMs = 0;
  private readonly MINIMAP_INTERVAL_MS = 250;

  // ---- LOD / frame-work reduction ----
  private readonly LABEL_ZOOM_THRESHOLD = 0.55;
  private readonly CULL_MARGIN = 150;
  private frameCount = 0;
  private readonly SLOW_TICK_EVERY = 6; // ~10 Hz slow tick at 60fps
  private forceSlowTick = true; // always run a slow tick on the very first frame
  private visibleNodeCount = 0;
  private edgesDirty = true;

  // ---- label/badge pooling (lazy creation is the biggest win at scale) ----
  private labelPool: Text[] = [];
  private badgePool: Text[] = [];
  private readonly LABEL_POOL_CAP = 300;
  private textColorDirty = false;

  // ---- adaptive frame rate ----
  private frameMsEma = 8;
  private readonly EMA_ALPHA = 0.08;
  private slowFrameStreak = 0;
  private fastFrameStreak = 0;
  private currentMaxFps = 60;
  private visibilityHandler = () => {
    if (document.hidden) this.app.ticker.stop();
    else this.app.ticker.start();
  };

  // ---- resize pause ----
  private resizePending: { w: number; h: number } | null = null;

  private dragging = false;
  private dragMoved = false;
  private lastPointer = { x: 0, y: 0 };
  // eased viewport animation target (zoom-to-subtree / focus); cancelled by
  // any manual pan or zoom
  private viewAnim: { x: number; y: number; scale: number } | null = null;
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
    this.world.addChild(this.pulseLayer);
    this.world.addChild(this.selectionRing);
    this.world.addChild(this.aggRingLayer);
    this.world.addChild(this.nodeLayer);
    this.app.stage.addChild(this.world);
    this.world.position.set(60, height / 2);

    // minimap lives in screen space, above the world
    this.minimap.addChild(this.minimapBg, this.minimapDots, this.minimapView);
    this.app.stage.addChild(this.minimap);
    this.positionMinimap();

    this.installPanZoom(canvas);
    this.app.ticker.add(() => this.frame());

    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private positionMinimap(): void {
    this.minimap.position.set(
      this.app.screen.width - this.minimapW - 14,
      this.app.screen.height - this.minimapH - 14
    );
  }

  setEndpoint(rgb: RGB): void {
    this.endpoint = rgb;
  }
  setTextColor(hex: number): void {
    this.textColor = hex;
    // active labels/badges update immediately; pooled (inactive) ones are
    // recoloured lazily on reuse via textColorDirty, so we don't have to walk
    // a pool of up to LABEL_POOL_CAP idle Text objects here
    for (const v of this.visuals.values()) {
      if (v.label) v.label.style.fill = hex;
      if (v.badge) v.badge.style.fill = hex;
    }
    this.textColorDirty = true;
  }
  setThemeUi(ui: ThemeUi): void {
    this.setTextColor(ui.text);
    this.accentColor = ui.accent;
    this.minimapBgColor = ui.minimapBg;
    this.minimapBgAlpha = ui.minimapBgAlpha;
    this.minimapBorderColor = ui.minimapBorder;
    this.pulseColor = ui.pulse;
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
  setCvdSafe(on: boolean): void {
    this.cvdSafe = on;
  }
  setCooldownMs(ms: number): void {
    this.cooldownMs = ms;
  }
  setFollowHottest(on: boolean): void {
    this.followHottest = on;
    if (!on) this.followTarget = null;
  }
  setMinimapVisible(on: boolean): void {
    this.minimapVisible = on;
    this.minimap.visible = on;
  }
  setMaxNodeSize(rMax: number): void {
    this.rMax = rMax;
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
    // adaptive debounce: big trees relayout (a d3-hierarchy pass + full visual
    // reconciliation) far less often so a busy broker doesn't thrash the layout
    const delay = this.model.topicCount <= 2000 ? 250 : 1000;
    setTimeout(() => {
      this.relayoutQueued = false;
      this.relayout();
    }, delay);
  }

  private installPanZoom(canvas: HTMLCanvasElement): void {
    canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.viewAnim = null;
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
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        this.dragMoved = true;
        this.viewAnim = null;
      }
      this.world.position.x += dx;
      this.world.position.y += dy;
      this.lastPointer = { x: e.global.x, y: e.global.y };
    });
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.app.stage.hitArea = this.app.screen;
    this.positionMinimap();
  }

  // Panel-drag resize support: pause the ticker for the duration of a drag
  // (many ResizeObserver events fire per drag) and only reallocate the canvas
  // backing store once, on the trailing edge. Caller (Svelte component) debounces
  // the endResize call; beginResize should be called on every observer event.
  beginResize(): void {
    this.app.ticker.stop();
  }

  endResize(width: number, height: number): void {
    this.resize(width, height);
    this.app.ticker.start();
  }

  // Snapshot for the dev harness FPS overlay / perf instrumentation.
  getPerfCounts(): { placedNodes: number; visibleNodes: number } {
    return { placedNodes: this.visuals.size, visibleNodes: this.visibleNodeCount };
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
      if (!v) {
        v = this.createVisual(pn.node);
        // new nodes slide out from their parent's current position
        const parent = pn.node.parent
          ? this.visuals.get(pn.node.parent.topic)
          : undefined;
        if (parent) v.container.position.set(parent.container.x, parent.container.y);
        else v.container.position.set(pn.x, pn.y);
      }
      v.expanded = pn.expanded;
      v.tx = pn.x;
      v.ty = pn.y;
      // re-arm easing: settled nodes drop out of the fast-path position loop
      // (moving = false), so any relayout that changes a node's target must
      // mark it moving again or it would freeze at its old position
      if (v.container.x !== pn.x || v.container.y !== pn.y) v.moving = true;
      this.updateCaretAndBadge(v);
    }
    // remove visuals no longer present
    for (const [topic, v] of this.visuals) {
      if (!seen.has(topic)) {
        v.container.destroy({ children: true });
        this.visuals.delete(topic);
        this.ripples = this.ripples.filter((rp) => rp.visual !== v);
      }
    }

    // edges as node-pair refs; positions resolved per-frame so they track animation
    this.edges = [];
    for (const pn of res.nodes) {
      const parentNode = pn.node.parent;
      if (!parentNode || parentNode === this.model.root) continue;
      const cv = this.visuals.get(pn.node.topic);
      const pv = this.visuals.get(parentNode.topic);
      if (cv && pv) this.edges.push([pv, cv]);
    }

    // structural change: force a full (slow-tick + edge rebuild) pass on the
    // very next frame regardless of the 6-frame cadence, and refresh the
    // minimap immediately rather than waiting out its throttle window
    this.forceSlowTick = true;
    this.edgesDirty = true;
    this.lastMinimapDrawMs = 0;
  }

  // Ease the viewport so `node` and its currently-visible descendants fill the
  // screen. Used for the "expand and bring into view" click behaviour and for
  // sidebar-driven selection focus.
  zoomToSubtree(node: TopicNode): void {
    const vw = this.app.screen.width;
    const vh = this.app.screen.height;
    if (vw <= 0 || vh <= 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const visit = (n: TopicNode) => {
      const v = this.visuals.get(n.topic);
      if (!v) return;
      if (v.tx < minX) minX = v.tx;
      if (v.ty < minY) minY = v.ty;
      if (v.tx > maxX) maxX = v.tx;
      if (v.ty > maxY) maxY = v.ty;
      for (const child of n.children.values()) visit(child);
    };
    visit(node);

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

    const marginLeft = 40;
    const marginRight = this.colW;
    const marginTop = this.rowH;
    const marginBottom = this.rowH;

    const boundsW = Math.max(1, maxX - minX + marginLeft + marginRight);
    const boundsH = Math.max(1, maxY - minY + marginTop + marginBottom);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const scale = Math.max(0.12, Math.min(1.2, Math.min(vw / boundsW, vh / boundsH)));

    this.viewAnim = {
      x: vw / 2 - centerX * scale,
      y: vh / 2 - centerY * scale,
      scale,
    };
  }

  // Sidebar-driven selection: expand every ancestor of `topic` (not the topic
  // itself), relayout, then zoom the subtree into view. No-op if the topic
  // isn't in the model (e.g. it hasn't arrived yet).
  focusTopic(topic: string): void {
    const segs = topic.split("/");
    let n = this.model.root;
    const path: TopicNode[] = [];
    for (const seg of segs) {
      const child = n.children.get(seg);
      if (!child) return;
      path.push(child);
      n = child;
    }
    const target = path[path.length - 1];
    for (let i = 0; i < path.length - 1; i++) path[i].expanded = true;
    this.relayout();
    this.zoomToSubtree(target);
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
      // collapsed parent: first click expands and brings the subtree into
      // view; an expanded (or leaf) node toggles selection
      if (node.children.size > 0 && !node.expanded) {
        node.expanded = true;
        this.cb.onToggle?.(node);
        this.relayout();
        this.zoomToSubtree(node);
        return;
      }
      this.cb.onSelect?.(this.selected === node.topic ? null : node.topic);
    });
    circle.on("pointerover", (e: any) => {
      this.cb.onHover?.(node.topic, e.global.x, e.global.y);
    });
    circle.on("pointermove", (e: any) => {
      if (this.dragging) return;
      this.cb.onHover?.(node.topic, e.global.x, e.global.y);
    });
    circle.on("pointerout", () => {
      this.cb.onHover?.(null, 0, 0);
    });
    container.addChild(circle);

    // Label/badge are NOT created here — they're the biggest per-node memory/CPU
    // cost (a Pixi Text = a canvas-rendered texture) and most nodes in a busy
    // tree are either culled or below the label zoom threshold at any moment.
    // They're created on demand in the slow tick (see acquireLabel/acquireBadge)
    // and released back into a pool rather than destroyed.
    const v: NodeVisual = {
      container,
      circle,
      label: null,
      caret: null,
      caretHover: false,
      badge: null,
      node,
      expanded: node.expanded,
      tx: 0,
      ty: 0,
      lastRippleMsg: node.expanded ? node.ownLastMsg : node.aggLastMsg,
      culled: false,
      moving: true,
      r: this.rMin,
    };
    this.nodeLayer.addChild(container);
    this.visuals.set(node.topic, v);
    return v;
  }

  // ---- label/badge pooling ----
  // Pool holds detached, hidden Text objects keyed by nothing in particular —
  // any pooled label can serve any node since text/style/position are reset on
  // acquire. Capped at LABEL_POOL_CAP; anything beyond that is destroyed rather
  // than pooled (bounds worst-case memory when the tree briefly has huge churn).
  private acquireLabel(v: NodeVisual, fontSize = 12): Text {
    if (v.label) return v.label;
    let t = this.labelPool.pop();
    if (t) {
      t.style.fontSize = fontSize;
      t.style.fill = this.textColor;
      t.visible = true;
    } else {
      t = new Text({
        text: "",
        style: {
          fill: this.textColor,
          fontSize,
          fontFamily: "Mona Sans, system-ui, sans-serif",
        },
      });
      t.anchor.set(0, 0.5);
    }
    v.container.addChild(t);
    v.label = t;
    return t;
  }

  private releaseLabel(v: NodeVisual): void {
    if (!v.label) return;
    const t = v.label;
    v.container.removeChild(t);
    v.label = null;
    if (this.labelPool.length < this.LABEL_POOL_CAP) {
      t.visible = false;
      this.labelPool.push(t);
    } else {
      t.destroy();
    }
  }

  private acquireBadge(v: NodeVisual): Text {
    if (v.badge) return v.badge;
    let t = this.badgePool.pop();
    if (t) {
      t.style.fill = this.textColor;
      t.visible = true;
    } else {
      t = new Text({
        text: "",
        style: { fill: this.textColor, fontSize: 10, fontFamily: "Mona Sans, system-ui, sans-serif" },
      });
      t.anchor.set(0, 0.5);
    }
    v.container.addChild(t);
    v.badge = t;
    return t;
  }

  private releaseBadge(v: NodeVisual): void {
    if (!v.badge) return;
    const t = v.badge;
    v.container.removeChild(t);
    v.badge = null;
    if (this.badgePool.length < this.LABEL_POOL_CAP) {
      t.visible = false;
      this.badgePool.push(t);
    } else {
      t.destroy();
    }
  }

  // caret geometry is centred on (0,0); frame() slides it left of the node
  // edge so large nodes never cover it
  private drawCaret(v: NodeVisual): void {
    if (!v.caret) return;
    v.caret.clear();
    if (v.caretHover) {
      v.caret.circle(0, 0, 10).fill({ color: 0x8a8a8a, alpha: 0.28 });
    }
    const a = v.caretHover ? 1 : 0.85;
    if (v.expanded) v.caret.poly([-5.5, -4, 5.5, -4, 0, 4.5]);
    else v.caret.poly([-4, -5.5, -4, 5.5, 4.5, 0]);
    v.caret.fill({ color: v.caretHover ? 0xbdbdbd : 0x8a8a8a, alpha: a });
  }

  // Creates (once) and redraws the caret graphic. Caret visibility for LOD
  // (zoomed out below the label threshold) and culling is handled per-frame in
  // the slow tick, not here — this only runs on structural relayout.
  private updateCaretAndBadge(v: NodeVisual): void {
    const hasChildren = v.node.children.size > 0;
    // caret (toggles expand) for nodes with children — a Graphics, not a Text,
    // so it's cheap enough to keep eagerly (unlike labels/badges)
    if (hasChildren && !v.caret) {
      const caret = new Graphics();
      caret.eventMode = "static";
      caret.cursor = "pointer";
      // generous hit circle: the triangle alone is a frustrating target
      caret.hitArea = new Circle(0, 0, 11);
      caret.on("pointertap", () => {
        if (this.dragMoved) return;
        v.node.expanded = !v.node.expanded;
        this.cb.onToggle?.(v.node);
        this.relayout();
        if (v.node.expanded) this.zoomToSubtree(v.node);
      });
      caret.on("pointerover", () => {
        v.caretHover = true;
        this.drawCaret(v);
      });
      caret.on("pointerout", () => {
        v.caretHover = false;
        this.drawCaret(v);
      });
      v.caret = caret;
      v.container.addChildAt(caret, 0);
    }
    if (v.caret) this.drawCaret(v);
  }

  // World-space visible rect (screen corners projected into world space),
  // expanded by CULL_MARGIN so nodes just off-screen don't pop in/out.
  private computeVisibleRect(): { minX: number; minY: number; maxX: number; maxY: number } {
    const tl = this.world.toLocal({ x: 0, y: 0 });
    const br = this.world.toLocal({ x: this.app.screen.width, y: this.app.screen.height });
    const m = this.CULL_MARGIN;
    return {
      minX: Math.min(tl.x, br.x) - m,
      minY: Math.min(tl.y, br.y) - m,
      maxX: Math.max(tl.x, br.x) + m,
      maxY: Math.max(tl.y, br.y) + m,
    };
  }

  private frame(): void {
    const nowMs = Date.now();
    this.updateAdaptiveFps();

    const showLabels = this.world.scale.x >= this.LABEL_ZOOM_THRESHOLD;
    const lodDetail = this.world.scale.x >= this.LABEL_ZOOM_THRESHOLD;
    let hottestTopic: string | null = null;
    let hottestMs = -1;

    this.frameCount++;
    const runSlowTick = this.forceSlowTick || this.frameCount % this.SLOW_TICK_EVERY === 0;
    this.forceSlowTick = false;

    const rect = this.computeVisibleRect();
    let anyMoved = false;
    this.visibleNodeCount = 0;

    for (const v of this.visuals.values()) {
      // ease position toward target (animated reflow on sort/expand/filter) —
      // always runs (fast path) but is a no-op once a node has settled, so
      // this loop body is cheap for the (common) majority of stationary nodes
      if (v.moving) {
        const dx = v.tx - v.container.x;
        const dy = v.ty - v.container.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.4) {
          v.container.x += dx * 0.25;
          v.container.y += dy * 0.25;
          anyMoved = true;
        } else {
          v.container.x = v.tx;
          v.container.y = v.ty;
          v.moving = false;
        }
      }

      // viewport culling: skip ALL further per-frame work for offscreen nodes
      const wasCulled = v.culled;
      const culled =
        v.container.x < rect.minX ||
        v.container.x > rect.maxX ||
        v.container.y < rect.minY ||
        v.container.y > rect.maxY;
      v.culled = culled;
      if (culled) {
        if (v.container.visible) {
          v.container.visible = false;
          // release pooled resources on the cull transition so labels/badges
          // from panned-away regions are reusable elsewhere instead of
          // accumulating on invisible containers
          if (v.label) this.releaseLabel(v);
          if (v.badge) this.releaseBadge(v);
        }
        // follow-hottest must still consider offscreen nodes: panning the
        // viewport to them is the whole point of the mode
        if (this.followHottest) {
          const lastMsg = v.expanded ? v.node.ownLastMsg : v.node.aggLastMsg;
          if (lastMsg > hottestMs) {
            hottestMs = lastMsg;
            hottestTopic = v.node.topic;
          }
        }
        continue;
      }
      if (!v.container.visible) v.container.visible = true;
      this.visibleNodeCount++;
      // a node transitioning culled -> visible needs its slow-tick state
      // (radius/tint/label) refreshed immediately rather than waiting for the
      // next 10Hz tick, or it'll render with stale (or default) values for a beat
      const justRevealed = wasCulled && !culled;

      if (runSlowTick || justRevealed) {
        const score = v.expanded
          ? this.model.ownScore(v.node, nowMs)
          : this.model.aggScore(v.node, nowMs);
        const lastMsg = v.expanded ? v.node.ownLastMsg : v.node.aggLastMsg;
        const r = radiusForScore(score, this.rMin, this.rMax, this.k);
        v.r = r;
        v.circle.scale.set(r / TEX_R);
        const age = lastMsg === 0 ? this.cooldownMs * 2 : nowMs - lastMsg;
        v.circle.tint = tintForAge(age, this.cooldownMs, this.endpoint, this.cvdSafe);

        // labels/badges: acquire lazily when visible + zoomed in enough, release otherwise
        if (showLabels) {
          const label = this.acquireLabel(v);
          // leaf label bug fix: always render just this node's own segment name,
          // never the full topic path — an empty segment (topic with a trailing
          // slash) renders as "/" rather than falling back to node.topic
          label.text = v.node.name === "" ? "/" : v.node.name;
          if (this.textColorDirty) label.style.fill = this.textColor;

          // expanded parents have an outgoing edge to the right — lift their
          // label above the line so it isn't struck through; leaves/collapsed
          // stay centred
          const hasVisibleKids = v.expanded && v.node.children.size > 0;
          if (hasVisibleKids) {
            label.anchor.y = 1;
            label.y = -4;
            label.x = r + 4;
          } else {
            label.anchor.y = 0.5;
            label.y = 0;
            label.x = r + 7;
          }
          label.visible = true;

          const showBadge = !v.expanded && v.node.descendantCount > 0;
          if (showBadge) {
            const badge = this.acquireBadge(v);
            if (this.textColorDirty) badge.style.fill = this.textColor;
            badge.text = `+${v.node.descendantCount}`;
            badge.x = r + 9 + label.width + 8;
            badge.visible = true;
          } else if (v.badge) {
            this.releaseBadge(v);
          }
        } else {
          if (v.label) this.releaseLabel(v);
          if (v.badge) this.releaseBadge(v);
        }

        // keep the caret clear of the node edge, however large the node grows;
        // below the label zoom threshold carets are untargetable at that scale
        // (and just visual noise), so hide the Graphics entirely
        if (v.caret) {
          v.caret.visible = lodDetail;
          if (lodDetail) v.caret.position.x = -(r + 10);
        }

        if (lastMsg > hottestMs) {
          hottestMs = lastMsg;
          hottestTopic = v.node.topic;
        }

        // message-arrival pulse: spawn a ripple when the rendered last-message
        // time advances, unless this node already rippled very recently (avoid
        // overdraw on hot topics ticking many times a second). No ripples at all
        // when zoomed out past the LOD threshold — they're imperceptible and
        // just cost draw calls.
        if (lodDetail && lastMsg > v.lastRippleMsg) {
          v.lastRippleMsg = lastMsg;
          const recent = this.ripples.find(
            (rp) => rp.visual === v && nowMs - rp.startMs < 150
          );
          if (!recent) {
            if (this.ripples.length >= this.RIPPLE_CAP) this.ripples.shift();
            this.ripples.push({ visual: v, startMs: nowMs });
          }
        } else if (lastMsg > v.lastRippleMsg) {
          // still track the edge even while suppressed, so a zoom-in afterwards
          // doesn't replay a backlog of "new" messages as ripples
          v.lastRippleMsg = lastMsg;
        }
      } else {
        // fast path, non-slow-tick frame: still need an up to date hottest-topic
        // candidate for follow-hottest, using the last-known lastMsg cheaply
        const lastMsg = v.expanded ? v.node.ownLastMsg : v.node.aggLastMsg;
        if (lastMsg > hottestMs) {
          hottestMs = lastMsg;
          hottestTopic = v.node.topic;
        }
      }
    }
    if (runSlowTick) this.textColorDirty = false;

    // edges: rebuild the Graphics only when something actually changed this
    // frame (a node moved, a relayout happened, or the slow tick ran — radii
    // shift label anchors but edges only depend on positions, so moved/relayout
    // are the real triggers; slow tick is included because cull transitions
    // change which edges are worth drawing)
    if (anyMoved || this.edgesDirty || runSlowTick) {
      this.edgeLayer.clear();
      for (const [p, c] of this.edges) {
        // skip drawing an edge when both endpoints are culled
        if (p.culled && c.culled) continue;
        const midX = c.container.x - 18;
        this.edgeLayer
          .moveTo(p.container.x, p.container.y)
          .lineTo(midX, p.container.y)
          .lineTo(midX, c.container.y)
          .lineTo(c.container.x, c.container.y);
      }
      this.edgeLayer.stroke({ width: 1.25, color: 0x8a8a8a, alpha: 0.28 });
      this.edgesDirty = false;
    }

    // message-arrival pulse ripples: expanding ring, eased out, fading
    this.pulseLayer.clear();
    if (this.ripples.length > 0) {
      const stillLive: Ripple[] = [];
      for (const rp of this.ripples) {
        if (rp.visual.culled) continue; // drop ripples whose visual is culled
        const elapsed = nowMs - rp.startMs;
        if (elapsed >= this.RIPPLE_DURATION_MS) continue;
        const t = elapsed / this.RIPPLE_DURATION_MS;
        const eased = 1 - (1 - t) * (1 - t);
        const r = rp.visual.r;
        const radius = r + eased * 16;
        const alpha = 0.85 * (1 - t);
        this.pulseLayer
          .circle(rp.visual.container.x, rp.visual.container.y, radius)
          .stroke({ width: 1.5, color: this.pulseColor, alpha });
        stillLive.push(rp);
      }
      this.ripples = stillLive;
    }

    // thin outline ring marks collapsed aggregates ("this circle sums a subtree")
    if (runSlowTick) {
      this.aggRingLayer.clear();
      if (lodDetail) {
        for (const v of this.visuals.values()) {
          if (v.culled || v.expanded || v.node.descendantCount === 0) continue;
          const r = v.r;
          this.aggRingLayer
            .circle(v.container.x, v.container.y, r + 2.5)
            .stroke({ width: 1, color: v.circle.tint as number, alpha: 0.55 });
        }
      }
    }

    // eased viewport animation (zoom-to-subtree / focus-from-sidebar)
    if (this.viewAnim) {
      const t = this.viewAnim;
      this.world.position.x += (t.x - this.world.position.x) * 0.16;
      this.world.position.y += (t.y - this.world.position.y) * 0.16;
      const ns = this.world.scale.x + (t.scale - this.world.scale.x) * 0.16;
      this.world.scale.set(ns);
      if (
        Math.abs(t.x - this.world.position.x) < 0.5 &&
        Math.abs(t.y - this.world.position.y) < 0.5 &&
        Math.abs(t.scale - this.world.scale.x) < 0.002
      ) {
        this.viewAnim = null;
      }
    }

    // follow-hottest: ease the viewport so the most-recent topic stays centred
    if (!this.viewAnim && this.followHottest && hottestTopic) {
      if (hottestMs > 0) this.followTarget = hottestTopic;
      const v = this.followTarget ? this.visuals.get(this.followTarget) : undefined;
      if (v) {
        const s = this.world.scale.x;
        const targetX = this.app.screen.width / 2 - v.container.x * s;
        const targetY = this.app.screen.height / 2 - v.container.y * s;
        this.world.position.x += (targetX - this.world.position.x) * 0.08;
        this.world.position.y += (targetY - this.world.position.y) * 0.08;
      }
    }

    // selection ring
    this.selectionRing.clear();
    if (this.selected) {
      const v = this.visuals.get(this.selected);
      if (v && !v.culled) {
        const r = v.r;
        this.selectionRing.circle(v.container.x, v.container.y, r + 5);
        this.selectionRing.stroke({ width: 2, color: this.accentColor, alpha: 0.9 });
      }
    }

    if (this.minimapVisible) {
      const dueMinimap = nowMs - this.lastMinimapDrawMs >= this.MINIMAP_INTERVAL_MS;
      if (dueMinimap) {
        this.lastMinimapDrawMs = nowMs;
        this.drawMinimap(nowMs);
      }
    }
  }

  // EMA of ticker.deltaMS drives an adaptive frame-rate cap: sustained slow
  // frames (busy tree, big relayout, etc.) drop the cap to 30fps to keep
  // interactions responsive; sustained fast frames restore 60fps. Hysteresis
  // (60-frame streaks in each direction) prevents flapping at the boundary.
  private updateAdaptiveFps(): void {
    const ms = this.app.ticker.elapsedMS;
    this.frameMsEma = this.frameMsEma + this.EMA_ALPHA * (ms - this.frameMsEma);

    if (this.frameMsEma > 14) {
      this.slowFrameStreak++;
      this.fastFrameStreak = 0;
    } else if (this.frameMsEma < 8) {
      this.fastFrameStreak++;
      this.slowFrameStreak = 0;
    } else {
      this.slowFrameStreak = 0;
      this.fastFrameStreak = 0;
    }

    if (this.currentMaxFps !== 30 && this.slowFrameStreak > 60) {
      this.currentMaxFps = 30;
      this.app.ticker.maxFPS = 30;
    } else if (this.currentMaxFps !== 60 && this.fastFrameStreak > 60) {
      this.currentMaxFps = 60;
      this.app.ticker.maxFPS = 60;
    }
  }

  private drawMinimap(nowMs: number): void {
    const pad = 8;
    const innerW = this.minimapW - pad * 2;
    const innerH = this.minimapH - pad * 2;
    // background
    this.minimapBg.clear();
    this.minimapBg
      .roundRect(0, 0, this.minimapW, this.minimapH, 8)
      .fill({ color: this.minimapBgColor, alpha: this.minimapBgAlpha });
    this.minimapBg
      .roundRect(0, 0, this.minimapW, this.minimapH, 8)
      .stroke({ width: 1, color: this.minimapBorderColor, alpha: 0.4 });

    const cw = Math.max(1, this.contentW + this.colW);
    const ch = Math.max(1, this.contentH + this.rMax * 2);
    const s = Math.min(innerW / cw, innerH / ch);

    this.minimapDots.clear();
    for (const v of this.visuals.values()) {
      const x = pad + v.tx * s;
      const y = pad + v.ty * s;
      const lastMsg = v.expanded ? v.node.ownLastMsg : v.node.aggLastMsg;
      const age = lastMsg === 0 ? this.cooldownMs * 2 : nowMs - lastMsg;
      this.minimapDots.circle(x, y, 1.6).fill({ color: tintForAge(age, this.cooldownMs, this.endpoint, this.cvdSafe), alpha: 0.85 });
    }

    // viewport rectangle (visible world region mapped into the minimap)
    const tl = this.world.toLocal({ x: 0, y: 0 });
    const br = this.world.toLocal({ x: this.app.screen.width, y: this.app.screen.height });
    const vx = pad + tl.x * s;
    const vy = pad + tl.y * s;
    const vw = (br.x - tl.x) * s;
    const vh = (br.y - tl.y) * s;
    this.minimapView.clear();
    this.minimapView
      .rect(
        Math.max(pad, vx),
        Math.max(pad, vy),
        Math.min(innerW, vw),
        Math.min(innerH, vh)
      )
      .stroke({ width: 1.5, color: this.accentColor, alpha: 0.9 });
  }

  destroy(): void {
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    for (const t of this.labelPool) t.destroy();
    for (const t of this.badgePool) t.destroy();
    this.labelPool = [];
    this.badgePool = [];
    this.app.destroy(true, { children: true });
    this.visuals.clear();
  }
}
