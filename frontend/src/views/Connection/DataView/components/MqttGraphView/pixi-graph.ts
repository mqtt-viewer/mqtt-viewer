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
  Rectangle,
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
import { layoutTopicTree, type LayoutResult, type SortKey } from "./tidy-layout";
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
  // set by the cull-recompute pass when this visual just transitioned
  // culled -> visible on a frame that wasn't itself a slow tick; the detail
  // pass (radius/tint/label) picks it up and clears it so a reveal never
  // renders stale for up to SLOW_TICK_EVERY frames
  justRevealed: boolean;
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
  // visuals eligible for the aggregate ring (collapsed node with a non-empty
  // subtree) — this is a purely structural property (v.expanded, descendantCount)
  // that only changes during relayout, so it's maintained there rather than
  // re-evaluated for every visual on every slow tick. The slow tick still
  // checks v.culled inline since culling is per-frame viewport state.
  private aggRingCandidates = new Set<NodeVisual>();
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
  // above this many visuals, drawMinimap subsamples (draws every Nth node so
  // the dot count stays roughly capped) and this redraw loop stretches its
  // throttle window — see drawMinimap and MINIMAP_SUBSAMPLE_TARGET
  private readonly MINIMAP_SUBSAMPLE_THRESHOLD = 3000;
  private readonly MINIMAP_SUBSAMPLE_TARGET = 3000;
  private readonly MINIMAP_INTERVAL_MS_LARGE = 1000;

  // ---- LOD / frame-work reduction ----
  private readonly LABEL_ZOOM_THRESHOLD = 0.55;
  private readonly CULL_MARGIN = 150;
  private frameCount = 0;
  private readonly SLOW_TICK_EVERY = 6; // ~10 Hz slow tick at 60fps
  private forceSlowTick = true; // always run a slow tick on the very first frame
  private visibleNodeCount = 0;
  private edgesDirty = true;

  // ---- moving-set fast path ----
  // Per-frame easing cost scales with the number of visuals still travelling
  // toward a target position, not the total placed count. relayout() adds any
  // visual whose target moved to this set; the easing step below removes a
  // visual once it settles. A busy broker with a mostly-static layout (only a
  // handful of nodes re-sorting per tick) then costs O(moving), not O(placed).
  private movingVisuals = new Set<NodeVisual>();

  // Set true by anything that can change what's on/off screen: pan, zoom,
  // resize, a running viewport animation (viewAnim/follow-hottest), or a slow
  // tick (nodes may have moved/appeared since the last cull pass). frame()
  // only walks the full visuals map to recompute culling when this is set or
  // a slow tick is due. Otherwise culling from the previous frame still
  // holds, bounded in staleness by the slow tick's ~10Hz cadence.
  private viewportDirty = true;

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

  // ---- perf HUD counters (see getPerfStats()) ----
  // Rendered-frames-per-second, counted directly in the ticker callback over
  // rolling ~1s windows, independent of frameMsEma, which is an EMA used to
  // drive the adaptive fps cap, not a literal frame count.
  private fpsWindowStart = 0;
  private fpsWindowFrames = 0;
  private lastFps = 0;

  private visibilityHandler = () => {
    if (document.hidden) this.app.ticker.stop();
    else this.app.ticker.start();
  };

  // ---- resize pause ----
  private resizePending: { w: number; h: number } | null = null;

  private dragging = false;
  private dragMoved = false;
  // pointer went down inside the minimap: moves re-centre the viewport on the
  // minimap point instead of panning the world by pixel delta
  private minimapDragging = false;
  private lastPointer = { x: 0, y: 0 };
  // eased viewport animation target (zoom-to-subtree / focus); cancelled by
  // any manual pan or zoom
  private viewAnim: { x: number; y: number; scale: number } | null = null;
  private relayoutQueued = false;
  private relayoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTopicCount = -1;
  // topology signature from the previous relayout (see relayout()); starts as
  // a value no real signature can equal so the very first relayout always
  // rebuilds the edge array
  private lastTopologySig = "";
  private contentW = 0;
  private contentH = 0;
  // One-shot "initial fit" — see applyInitialView(). Set true either once the
  // fit has actually run, or as soon as the user pans/zooms (so a slow broker
  // that only crosses INITIAL_VIEW_MIN_NODES after the user already started
  // interacting doesn't yank the viewport out from under them).
  private initialViewApplied = false;
  // rows of the laid-out tree to fit on first meaningful layout
  private readonly INITIAL_VIEW_ROWS = 25;
  // minimum node count before the initial fit is worth doing at all — below
  // this the whole tree already fits legibly, so fitView()'s default framing
  // (called from onMount) is fine and there's nothing to "cancel" here.
  private readonly INITIAL_VIEW_MIN_NODES = 10;

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
    this.installMinimapNav();

    this.installPanZoom(canvas);
    this.app.ticker.add(() => this.frame());
    // apply the default cap up front: Pixi's ticker is otherwise uncapped
    // (maxFPS 0), which ran the graph at display rate (e.g. 120Hz) while the
    // HUD and adaptive logic assumed a 60fps ceiling
    this.app.ticker.maxFPS = this.currentMaxFps;

    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private positionMinimap(): void {
    this.minimap.position.set(
      this.app.screen.width - this.minimapW - 14,
      this.app.screen.height - this.minimapH - 14
    );
  }

  // Click-to-navigate / drag-to-pan (spec §minimap: "draggable viewport
  // rectangle"). Pointer-down centres the viewport on the clicked point;
  // while the pointer stays down, moves keep re-centring, which reads as
  // dragging the viewport rectangle. The move/up halves live on the stage
  // handlers in installPanZoom so a drag that leaves the minimap keeps
  // working until release.
  private installMinimapNav(): void {
    this.minimap.eventMode = "static";
    this.minimap.cursor = "pointer";
    this.minimap.hitArea = new Rectangle(0, 0, this.minimapW, this.minimapH);
    this.minimap.on("pointerdown", (e: any) => {
      e.stopPropagation(); // don't also start a world drag
      this.minimapDragging = true;
      this.viewAnim = null;
      this.initialViewApplied = true; // user navigated: never auto-fit again
      this.panToMinimapPoint(e.global.x, e.global.y);
    });
  }

  // World-units-per-minimap-pixel mapping shared by drawMinimap and
  // panToMinimapPoint — must stay identical in both or the viewport
  // rectangle and the click target drift apart.
  private minimapMapping(): { pad: number; innerW: number; innerH: number; s: number } {
    const pad = 8;
    const innerW = this.minimapW - pad * 2;
    const innerH = this.minimapH - pad * 2;
    const cw = Math.max(1, this.contentW + this.colW);
    const ch = Math.max(1, this.contentH + this.rMax * 2);
    return { pad, innerW, innerH, s: Math.min(innerW / cw, innerH / ch) };
  }

  private panToMinimapPoint(globalX: number, globalY: number): void {
    const { pad, s } = this.minimapMapping();
    if (s <= 0) return;
    const local = this.minimap.toLocal({ x: globalX, y: globalY });
    const wx = (local.x - pad) / s;
    const wy = (local.y - pad) / s;
    const scale = this.world.scale.x;
    this.world.position.set(
      this.app.screen.width / 2 - wx * scale,
      this.app.screen.height / 2 - wy * scale
    );
    this.viewportDirty = true;
    // move the viewport rectangle with the pointer instead of waiting out the
    // minimap redraw throttle (up to 1s on huge trees) — the rect alone is
    // cheap to redraw every frame, unlike the dots
    this.drawMinimapViewRect();
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
    this.model.markExpansionChanged();
    this.relayout();
  }

  // call after ingesting messages; cheaply relayouts only if the LAID-OUT tree
  // could actually have changed. model.visibleDirty is only set by arrivals
  // reachable under a fully-expanded ancestor chain, so a busy broker whose
  // new topics land under collapsed nodes no longer thrashes the layout —
  // their counters/badges still update, just via the next slow tick rather
  // than a relayout.
  notifyData(): void {
    if (this.model.visibleDirty) {
      this.scheduleRelayout();
    }
  }

  scheduleRelayout(): void {
    // nothing visible changed since the last relayout: no-op rather than
    // queueing a debounce timer that will just re-run an identical layout
    if (!this.model.visibleDirty) return;
    if (this.relayoutQueued) return;
    this.relayoutQueued = true;
    // adaptive debounce: big trees relayout (a d3-hierarchy pass + full visual
    // reconciliation) far less often so a busy broker doesn't thrash the layout
    const delay = this.model.topicCount <= 2000 ? 250 : 1000;
    this.relayoutTimer = setTimeout(() => {
      this.relayoutTimer = null;
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
        this.initialViewApplied = true; // user zoomed: never auto-fit again
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
        this.viewportDirty = true;
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
      this.minimapDragging = false;
    });
    this.app.stage.on("pointerupoutside", () => {
      this.dragging = false;
      this.minimapDragging = false;
    });
    this.app.stage.on("pointermove", (e: any) => {
      if (this.minimapDragging) {
        this.panToMinimapPoint(e.global.x, e.global.y);
        return;
      }
      if (!this.dragging) return;
      const dx = e.global.x - this.lastPointer.x;
      const dy = e.global.y - this.lastPointer.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        this.dragMoved = true;
        this.viewAnim = null;
        this.initialViewApplied = true; // user panned: never auto-fit again
      }
      this.world.position.x += dx;
      this.world.position.y += dy;
      this.lastPointer = { x: e.global.x, y: e.global.y };
      this.viewportDirty = true;
    });
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.app.stage.hitArea = this.app.screen;
    this.positionMinimap();
    this.viewportDirty = true;
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

  // Fuller snapshot backing the in-app performance HUD (see MqttGraphView's
  // "Performance stats" toggle) and the perf-graph.mjs regression script.
  getPerfStats(): {
    fps: number;
    avgFrameMs: number;
    maxFps: number;
    placedNodes: number;
    visibleNodes: number;
    movingNodes: number;
    liveRipples: number;
  } {
    return {
      fps: this.lastFps,
      avgFrameMs: Math.round(this.frameMsEma * 100) / 100,
      maxFps: this.currentMaxFps,
      placedNodes: this.visuals.size,
      visibleNodes: this.visibleNodeCount,
      movingNodes: this.movingVisuals.size,
      liveRipples: this.ripples.length,
    };
  }

  // True once the one-shot initial fit (top rows of sort order) has run, or
  // once the user has panned/zoomed. Callers use this to skip a redundant
  // automatic fitView() (whole-tree fit) that would otherwise immediately
  // undo the initial fit right after mount — an explicit, user-invoked
  // fitView() call (e.g. the toolbar button) should never consult this.
  hasAppliedInitialView(): boolean {
    return this.initialViewApplied;
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
    this.viewportDirty = true;
  }

  relayout(): void {
    const nowMs = Date.now();
    this.lastTopicCount = this.model.topicCount;
    // consumed: this relayout is the response to whatever made the visible
    // tree dirty, so clear it before running (an arrival during layoutTopicTree
    // itself, e.g. from another tab of the same event loop tick, would still
    // be free to set it again for the next pass)
    this.model.visibleDirty = false;
    const res = layoutTopicTree(this.model, {
      rowH: this.rowH,
      colW: this.colW,
      sortKey: this.sortKey,
      nowMs,
      filter: this.filter,
    });
    this.contentW = res.width;
    this.contentH = res.height;

    // topology signature: node count + the model's structure-generation
    // counter. The counter only bumps on add/remove/expansion-change, so two
    // relayouts with the same signature are guaranteed to share the same node
    // set and parent links — only scores/positions could have moved. Filter
    // changes don't bump structureGen, so a filter edit still forces a rebuild
    // (its result set differs from the unfiltered layout) via the filter check.
    const topology = `${this.model.topicCount}:${this.model.structureGen}:${this.filter}`;
    const topologyChanged = topology !== this.lastTopologySig;
    this.lastTopologySig = topology;

    let anyPositionChanged = false;
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
        // createVisual() always starts a node as moving = true (it may need to
        // ease in from its parent's position even when pn.x/pn.y already match
        // the spawn point, e.g. the no-parent case above), so keep it in the set
        this.movingVisuals.add(v);
      }
      v.expanded = pn.expanded;
      if (v.tx !== pn.x || v.ty !== pn.y) anyPositionChanged = true;
      v.tx = pn.x;
      v.ty = pn.y;
      // re-arm easing: settled nodes drop out of the fast-path position loop
      // (moving = false), so any relayout that changes a node's target must
      // mark it moving again, and back into movingVisuals, or it would
      // freeze at its old position
      if (v.container.x !== pn.x || v.container.y !== pn.y) {
        v.moving = true;
        this.movingVisuals.add(v);
      }
      this.updateCaretAndBadge(v);
      // aggregate-ring eligibility (collapsed + has descendants) is structural
      // and only changes here, at relayout time — recompute membership so the
      // slow tick can iterate just this set instead of every visual
      if (!v.expanded && v.node.descendantCount > 0) {
        this.aggRingCandidates.add(v);
      } else {
        this.aggRingCandidates.delete(v);
      }
    }
    // remove visuals no longer present
    for (const [topic, v] of this.visuals) {
      if (!seen.has(topic)) {
        v.container.destroy({ children: true });
        this.visuals.delete(topic);
        this.ripples = this.ripples.filter((rp) => rp.visual !== v);
        this.aggRingCandidates.delete(v);
        this.movingVisuals.delete(v);
        anyPositionChanged = true; // a removal always changes what's drawn
      }
    }

    // edges: the node-pair array only needs rebuilding when topology changed
    // (a node/link was added or removed, or an expansion toggle changed which
    // links are reachable) — positions are resolved per-frame off the visuals
    // themselves, so a pure re-sort (same nodes, new order/positions) can keep
    // the existing array and just redraw the Graphics from it.
    if (topologyChanged) {
      this.edges = [];
      for (const pn of res.nodes) {
        const parentNode = pn.node.parent;
        if (!parentNode || parentNode === this.model.root) continue;
        const cv = this.visuals.get(pn.node.topic);
        const pv = this.visuals.get(parentNode.topic);
        if (cv && pv) this.edges.push([pv, cv]);
      }
    }

    // force a full (slow-tick + edge rebuild) pass on the very next frame
    // regardless of the 6-frame cadence, and refresh the minimap immediately
    // rather than waiting out its throttle window — but only when something a
    // viewer could actually perceive changed. A relayout that reproduced the
    // exact same topology and positions (e.g. a re-sort tick that didn't
    // reorder anything) is a genuine no-op down here.
    if (topologyChanged || anyPositionChanged) {
      this.forceSlowTick = true;
      this.edgesDirty = true;
      this.lastMinimapDrawMs = 0;
    }

    this.applyInitialView(res);
  }

  // One-shot: on the first relayout where the tree has grown past a trivial
  // size, frame the viewport on the top INITIAL_VIEW_ROWS rows of the current
  // sort order (rather than fitView()'s whole-tree fit, which on a big broker
  // is a useless, illegibly-zoomed-out vertical line). "Top of sort order" is
  // the smallest-y rows of the laid-out tree — the layout is a vertical tidy
  // tree, so y is breadth position and lower y is literally higher on screen,
  // regardless of depth. No-ops once run, or once the user has interacted
  // (see initialViewApplied writes in installPanZoom).
  private applyInitialView(res: LayoutResult): void {
    if (this.initialViewApplied) return;
    if (res.nodes.length < this.INITIAL_VIEW_MIN_NODES) return;

    const vw = this.app.screen.width;
    const vh = this.app.screen.height;
    if (vw <= 0 || vh <= 0) return;

    const topRows = [...res.nodes].sort((a, b) => a.y - b.y).slice(0, this.INITIAL_VIEW_ROWS);
    if (topRows.length === 0) return;
    this.initialViewApplied = true;

    let minX = 0; // always include the root/first-level column
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const pn of topRows) {
      if (pn.x < minX) minX = pn.x;
      if (pn.y < minY) minY = pn.y;
      if (pn.x > maxX) maxX = pn.x;
      if (pn.y > maxY) maxY = pn.y;
    }

    const marginLeft = 40;
    const marginRight = this.colW; // room for the last column's label
    const marginTop = this.rowH;
    const marginBottom = this.rowH;

    const boundsW = Math.max(1, maxX - minX + marginLeft + marginRight);
    const boundsH = Math.max(1, maxY - minY + marginTop + marginBottom);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // clamp to at least the label threshold: a readable initial view is the
    // whole point, so never let a huge bounding box zoom out past legibility
    // (the bottom clamp still allows zooming in further on a very short list).
    const fitScale = Math.min(vw / boundsW, vh / boundsH);
    const scale = Math.max(this.LABEL_ZOOM_THRESHOLD, Math.min(1.2, fitScale));

    this.world.scale.set(scale);
    this.world.position.set(vw / 2 - centerX * scale, vh / 2 - centerY * scale);
    this.viewportDirty = true;
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
    this.model.markExpansionChanged();
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
        this.model.markExpansionChanged();
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
      justRevealed: false,
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
        this.model.markExpansionChanged();
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

  // Recompute a visible visual's radius/tint/label/badge/caret, and (when
  // spawnRipple) detect a message-arrival edge and spawn a pulse ring. Shared
  // by the slow tick (every visual, ~10Hz) and the just-revealed fast path (a
  // single visual, the frame it comes back on screen). Returns the resolved
  // lastMsg so callers can fold it into hottest-topic tracking without
  // re-deriving expanded/own-vs-agg themselves. Caller must have already
  // confirmed the visual isn't culled.
  private refreshVisualDetail(
    v: NodeVisual,
    nowMs: number,
    showLabels: boolean,
    lodDetail: boolean,
    spawnRipple: boolean
  ): number {
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

    if (!spawnRipple) {
      v.lastRippleMsg = lastMsg;
      return lastMsg;
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

    return lastMsg;
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
    const workStart = performance.now();
    this.updateFpsCounter(nowMs);

    const showLabels = this.world.scale.x >= this.LABEL_ZOOM_THRESHOLD;
    const lodDetail = this.world.scale.x >= this.LABEL_ZOOM_THRESHOLD;

    this.frameCount++;
    const runSlowTick = this.forceSlowTick || this.frameCount % this.SLOW_TICK_EVERY === 0;
    this.forceSlowTick = false;

    // an in-flight viewport animation (zoom-to-subtree / follow-hottest) moves
    // the camera every frame it's active, so culling must be re-checked every
    // such frame too. Set here (before the cull pass below reads it) rather
    // than at the end where the actual position update happens.
    if (this.viewAnim || (this.followHottest && this.followTarget)) {
      this.viewportDirty = true;
    }

    // ---- moving-set fast path ----
    // Ease only the visuals still travelling toward a target; this loop's
    // cost is O(moving), not O(placed). A settled node is dropped from the
    // set so a busy-but-static tree (most nodes stationary between re-sorts)
    // doesn't pay for a full-visuals walk here every frame.
    let anyMoved = false;
    if (this.movingVisuals.size > 0) {
      for (const v of this.movingVisuals) {
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
          this.movingVisuals.delete(v);
        }
      }
    }

    // ---- culling (viewport-dirty gated) ----
    // Recompute cull state for every visual only when the viewport actually
    // changed (pan/zoom/resize/viewport-animation) or the slow tick is due
    // (nodes may have moved/appeared since the last cull pass ran). The slow
    // tick's ~10Hz cadence is the upper bound on how stale culling can get.
    // Otherwise last frame's cull state (and visibleNodeCount) still holds,
    // so an unchanged viewport with no slow tick due skips this walk entirely.
    const recomputeCull = this.viewportDirty || runSlowTick;
    if (recomputeCull) {
      const rect = this.computeVisibleRect();
      this.visibleNodeCount = 0;
      for (const v of this.visuals.values()) {
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
          continue;
        }
        if (!v.container.visible) v.container.visible = true;
        this.visibleNodeCount++;
        // a node transitioning culled -> visible needs its slow-tick state
        // (radius/tint/label) refreshed immediately rather than waiting for
        // the next 10Hz tick, or it'll render with stale/default values for a
        // beat. Mark it here so the detail pass below picks it up even on a
        // frame where runSlowTick is false but the viewport just moved.
        if (wasCulled) v.justRevealed = true;
      }
      this.viewportDirty = false;
    }

    // ---- slow tick: hottest-topic tracking, radius/tint/labels/ripples ----
    // Runs the O(placed) detail pass at ~10Hz rather than every frame. Culled
    // nodes are skipped except for follow-hottest, which must still consider
    // them (panning the viewport to an offscreen hot topic is the point).
    let hottestTopic: string | null = null;
    let hottestMs = -1;
    if (runSlowTick) {
      for (const v of this.visuals.values()) {
        if (v.culled) {
          if (this.followHottest) {
            const lastMsg = v.expanded ? v.node.ownLastMsg : v.node.aggLastMsg;
            if (lastMsg > hottestMs) {
              hottestMs = lastMsg;
              hottestTopic = v.node.topic;
            }
          }
          continue;
        }

        const lastMsg = this.refreshVisualDetail(v, nowMs, showLabels, lodDetail, true);
        v.justRevealed = false;

        if (lastMsg > hottestMs) {
          hottestMs = lastMsg;
          hottestTopic = v.node.topic;
        }
      }
      this.textColorDirty = false;
    } else if (recomputeCull) {
      // Not a slow-tick frame, but the cull pass above still ran (viewport
      // changed), so a node revealed this frame needs its detail refreshed
      // immediately rather than rendering stale for up to SLOW_TICK_EVERY
      // frames. Ripple edge-detection is intentionally skipped for these
      // (see refreshVisualDetail's spawnRipple param): a just-revealed node's
      // backlog of "new" messages while offscreen/stale shouldn't replay as
      // ripples. The next slow tick picks up its cadence cleanly.
      for (const v of this.visuals.values()) {
        if (!v.justRevealed) continue;
        v.justRevealed = false;
        this.refreshVisualDetail(v, nowMs, showLabels, lodDetail, false);
      }
    }
    // follow-hottest still needs a candidate on non-slow-tick frames; rather
    // than re-scanning all visuals every frame, the easing below rides on
    // whatever followTarget the last slow tick established.

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

    // thin outline ring marks collapsed aggregates ("this circle sums a subtree").
    // aggRingCandidates already narrows to the (collapsed, has-descendants)
    // structural condition — only v.culled is re-checked here, since culling
    // is per-frame viewport state that isn't tracked in the set.
    if (runSlowTick) {
      this.aggRingLayer.clear();
      if (lodDetail) {
        for (const v of this.aggRingCandidates) {
          if (v.culled) continue;
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

    // follow-hottest: ease the viewport so the most-recent topic stays centred.
    // The candidate search (hottestTopic/hottestMs) only runs on slow-tick
    // frames now, but the easing itself must run every frame toward whatever
    // followTarget was last set to, or the camera would visibly step at 10Hz
    // instead of easing smoothly.
    if (runSlowTick && this.followHottest && hottestTopic && hottestMs > 0) {
      this.followTarget = hottestTopic;
    }
    if (!this.viewAnim && this.followHottest && this.followTarget) {
      const v = this.visuals.get(this.followTarget);
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
      // huge trees stretch the throttle window further — the minimap is a
      // rough overview, not a precise instrument, and redrawing (+ subsampling)
      // it at full 4Hz over 10k+ visuals is wasted work on every busy tick
      const interval =
        this.visuals.size > this.MINIMAP_SUBSAMPLE_THRESHOLD
          ? this.MINIMAP_INTERVAL_MS_LARGE
          : this.MINIMAP_INTERVAL_MS;
      const dueMinimap = nowMs - this.lastMinimapDrawMs >= interval;
      if (dueMinimap) {
        this.lastMinimapDrawMs = nowMs;
        this.drawMinimap(nowMs);
      }
    }

    this.updateAdaptiveFps(performance.now() - workStart);
  }

  // EMA of per-frame WORK time (measured around the frame() body) drives an
  // adaptive frame-rate cap: sustained slow frames (busy tree, big relayout,
  // etc.) drop the cap to 30fps to keep interactions responsive; sustained
  // fast frames restore 60fps. Hysteresis (60-frame streaks in each
  // direction) prevents flapping at the boundary.
  //
  // Work time, NOT ticker.elapsedMS: elapsed time between ticks includes the
  // idle wait imposed by the display rate and the cap itself, so on a plain
  // 60Hz display it reads ~16.7ms regardless of load — permanently past the
  // 14ms threshold, which would wrongly degrade every 60Hz user to 30fps.
  private updateAdaptiveFps(workMs: number): void {
    this.frameMsEma = this.frameMsEma + this.EMA_ALPHA * (workMs - this.frameMsEma);

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

  // Counts actual rendered frames per rolling ~1s window: the literal fps
  // the HUD/perf script report, as distinct from frameMsEma (a smoothed
  // per-frame cost used only to drive the adaptive cap above).
  private updateFpsCounter(nowMs: number): void {
    if (this.fpsWindowStart === 0) this.fpsWindowStart = nowMs;
    this.fpsWindowFrames++;
    const elapsed = nowMs - this.fpsWindowStart;
    if (elapsed >= 1000) {
      this.lastFps = Math.round((this.fpsWindowFrames * 1000) / elapsed);
      this.fpsWindowFrames = 0;
      this.fpsWindowStart = nowMs;
    }
  }

  private drawMinimap(nowMs: number): void {
    const { pad, s } = this.minimapMapping();
    // background
    this.minimapBg.clear();
    this.minimapBg
      .roundRect(0, 0, this.minimapW, this.minimapH, 8)
      .fill({ color: this.minimapBgColor, alpha: this.minimapBgAlpha });
    this.minimapBg
      .roundRect(0, 0, this.minimapW, this.minimapH, 8)
      .stroke({ width: 1, color: this.minimapBorderColor, alpha: 0.4 });

    // subsample huge trees: drawing every visual's dot + colorForAge every
    // interval doesn't scale past a few thousand nodes, and the minimap is an
    // overview, not a precise instrument — every Nth node (stride computed so
    // the drawn count stays near MINIMAP_SUBSAMPLE_TARGET) still conveys the
    // overall shape/density of the tree.
    const total = this.visuals.size;
    const stride =
      total > this.MINIMAP_SUBSAMPLE_THRESHOLD
        ? Math.ceil(total / this.MINIMAP_SUBSAMPLE_TARGET)
        : 1;

    this.minimapDots.clear();
    let i = 0;
    for (const v of this.visuals.values()) {
      if (stride > 1 && i % stride !== 0) {
        i++;
        continue;
      }
      i++;
      const x = pad + v.tx * s;
      const y = pad + v.ty * s;
      const lastMsg = v.expanded ? v.node.ownLastMsg : v.node.aggLastMsg;
      const age = lastMsg === 0 ? this.cooldownMs * 2 : nowMs - lastMsg;
      this.minimapDots.circle(x, y, 1.6).fill({ color: tintForAge(age, this.cooldownMs, this.endpoint, this.cvdSafe), alpha: 0.85 });
    }

    this.drawMinimapViewRect();
  }

  // viewport rectangle (visible world region mapped into the minimap) —
  // separate from drawMinimap so a minimap drag can redraw just the rect
  // every frame without paying for the dots
  private drawMinimapViewRect(): void {
    const { pad, innerW, innerH, s } = this.minimapMapping();
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
    // a pending relayout would otherwise fire (up to 1s later) against the
    // destroyed Pixi app when the user toggles Graph -> List quickly
    if (this.relayoutTimer !== null) {
      clearTimeout(this.relayoutTimer);
      this.relayoutTimer = null;
      this.relayoutQueued = false;
    }
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    for (const t of this.labelPool) t.destroy();
    for (const t of this.badgePool) t.destroy();
    this.labelPool = [];
    this.badgePool = [];
    this.app.destroy(true, { children: true });
    this.visuals.clear();
    this.aggRingCandidates.clear();
    this.movingVisuals.clear();
  }
}
