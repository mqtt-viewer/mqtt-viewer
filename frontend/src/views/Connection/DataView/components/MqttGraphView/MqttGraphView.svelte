<script lang="ts" context="module">
  /** Feed of MQTT message arrivals; defaults to the Wails event stream.
   *  Injectable so storybook / browser harnesses can drive synthetic traffic. */
  export interface GraphMessageSource {
    subscribe: (
      onMessages: (msgs: Array<{ topic: string; timeMs?: number }>) => void,
      onClear: () => void
    ) => () => void;
  }

  // Which namespaces the user has drilled into is a property of the
  // connection, not of this component instance: the panel swaps components on
  // every List <-> Graph toggle, so without this the graph collapsed back to
  // the roots every time you looked at the list. Keyed by connection id.
  const expansionByConnection = new Map<string, Set<string>>();
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Events } from "@wailsio/runtime";
  import { get } from "svelte/store";
  import _ from "lodash";
  import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
  import type { Connection } from "@/stores/connections";
  import type { SelectedTopicStore } from "../../stores/selected-topic-store";
  import type { MqttData } from "../MqttDataPanel/stores/mqtt-data";
  import type { SearchStore } from "../MqttDataPanel/stores/search";
  import theme from "@/stores/theme";
  import PanelHeader from "@/components/PanelHeader/PanelHeader.svelte";
  import BaseInput from "@/components/InputFields/BaseInput.svelte";
  import Button from "@/components/Button/Button.svelte";
  import Icon from "@/components/Icon/Icon.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import DropdownMenu from "@/components/DropdownMenu/DropdownMenu.svelte";
  import DropdownMenuItem from "@/components/DropdownMenu/DropdownMenuItem.svelte";
  import { untypedColors } from "@/util/resolvedTailwindConfig";
  import { LIST_RATE_TAU_MS, type DecayScore } from "@/util/decay-score";
  import { TopicModel, type TopicNode } from "./topic-model";
  import { TopicGraphRenderer } from "./pixi-graph";
  import {
    COLD_ENDPOINT_DARK,
    COLD_ENDPOINT_LIGHT,
    formatRate,
    rampCssGradient,
    rateFromScore,
  } from "./cooldown";
  import { coerceSortKey, type SortKey } from "./tidy-layout";

  export let connection: Connection;
  export let selectedTopicStore: SelectedTopicStore;
  /** snapshot used once on mount to seed the tree so it isn't empty */
  export let initialData: MqttData = {};
  export let width = 0;
  /** override the live message feed (storybook / dev harnesses) */
  export let messageSource: GraphMessageSource | undefined = undefined;
  /** shared filter text store from the List view, so filter survives the
   *  List<->Graph toggle. Absent in storybook/dev: falls back to local state. */
  export let searchStore: SearchStore | undefined = undefined;

  let canvasEl: HTMLCanvasElement;
  let containerEl: HTMLDivElement;
  let containerW = 0;
  let containerH = 0;
  const model = new TopicModel();
  let renderer: TopicGraphRenderer | null = null;
  let unsubSource: (() => void) | null = null;
  let unsubSearch: (() => void) | null = null;
  let ro: ResizeObserver | null = null;
  let io: IntersectionObserver | null = null;
  let liveTimer: number | null = null;
  let everSized = false;
  let resizeDebounce: number | null = null;
  // set by onDestroy; the async mount below checks it after every await so a
  // teardown that lands mid-init can't register anything that outlives it
  let destroyed = false;
  let onScreen = true;
  // true when the mount revealed an inbound selection, so the first-size
  // handler doesn't immediately fit the whole tree back over it
  let revealedOnMount = false;
  // node counts behind the empty-state overlay, refreshed on every relayout
  let placedNodes = 0;
  let topicCount = 0;

  // Seed from the shared store (when present) BEFORE the reactive push below
  // runs, so switching in from the List doesn't clobber existing filter text.
  let filterText = searchStore ? get(searchStore).text : "";
  let sortKey: SortKey = "rate";
  let paused = false;
  let allExpanded = false;
  // anchors the "Sorting paused" note under the pause button (the header
  // clips overflow, so the note lives in the canvas overlay instead)
  let pauseWrapEl: HTMLDivElement | undefined;
  $: pausedNoteLeft =
    paused && pauseWrapEl
      ? Math.max(8, Math.min(pauseWrapEl.offsetLeft, containerW - 110))
      : 8;

  const SORT_LABELS: Record<SortKey, string> = {
    rate: "Busiest first",
    msgs: "Most messages",
    recency: "Newest first",
    stale: "Silent first",
    alpha: "Topic A → Z",
    count: "Topic count",
  };

  // persisted view preferences (scoped per connection)
  const connectionKey = () => String(connection.connectionDetails.id);
  const settingsKey = () => `mqtt-viewer-topicgraph-settings:${connectionKey()}`;
  let minimapOn = true;
  let followHottest = false;
  let cvdSafe = false;
  let legendOn = true;
  let statsOn = false;
  let cooldownMs = 60000;
  let tauMs = 14000; // EWMA half-life ~10s by default
  let maxNodeR = 20;
  const COOLDOWNS: Array<[string, number]> = [
    ["30 seconds", 30000],
    ["1 minute", 60000],
    ["5 minutes", 300000],
    ["15 minutes", 900000],
    ["1 hour", 3600000],
    ["6 hours", 21600000],
    ["24 hours", 86400000],
  ];
  const COOLDOWN_SHORT: Record<number, string> = {
    30000: "30s",
    60000: "1m",
    300000: "5m",
    900000: "15m",
    3600000: "1h",
    21600000: "6h",
    86400000: "24h",
  };
  const SMOOTHING: Array<[string, number]> = [
    ["Responsive (5s)", 5000],
    ["Balanced (14s)", 14000],
    ["Smooth (40s)", 40000],
  ];
  const MAX_NODE_SIZES: Array<[string, number]> = [
    ["Compact", 14],
    ["Standard", 20],
    ["Large", 28],
  ];

  const loadSettings = () => {
    try {
      const raw = localStorage.getItem(settingsKey());
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.minimapOn === "boolean") minimapOn = s.minimapOn;
      if (typeof s.followHottest === "boolean") followHottest = s.followHottest;
      if (typeof s.cvdSafe === "boolean") cvdSafe = s.cvdSafe;
      if (typeof s.legendOn === "boolean") legendOn = s.legendOn;
      if (typeof s.statsOn === "boolean") statsOn = s.statsOn;
      if (typeof s.cooldownMs === "number") cooldownMs = s.cooldownMs;
      if (typeof s.tauMs === "number") tauMs = s.tauMs;
      if (typeof s.maxNodeR === "number") maxNodeR = s.maxNodeR;
      // validate against the full key union; unknown/missing coerces to the
      // "rate" default so an older blob (no sortKey) or garbage never reaches
      // the sort comparators
      sortKey = coerceSortKey(s.sortKey);
    } catch (e) {
      console.error("topic-graph settings load failed", e);
    }
  };
  const saveSettings = () => {
    try {
      localStorage.setItem(
        settingsKey(),
        JSON.stringify({
          minimapOn,
          followHottest,
          cvdSafe,
          legendOn,
          statsOn,
          cooldownMs,
          tauMs,
          maxNodeR,
          sortKey,
        })
      );
    } catch (e) {
      console.error("topic-graph settings save failed", e);
    }
  };
  const applySettings = () => {
    if (!renderer) return;
    renderer.setMinimapVisible(minimapOn);
    renderer.setFollowHottest(followHottest);
    renderer.setCvdSafe(cvdSafe);
    renderer.setCooldownMs(cooldownMs);
    renderer.setMaxNodeSize(maxNodeR);
    renderer.setSort(sortKey); // reflect the persisted sort into the renderer
    model.setTau(tauMs);
  };

  const seed = (data: MqttData) => {
    // The List accumulated its rate scores at LIST_RATE_TAU_MS, but the graph's
    // tau is user-configurable. At steady state score = rate x tau, so a score
    // transplanted across taus misreports rate magnitude by tauGraph/tauList;
    // scale every seeded score by this factor so both views agree on busyness.
    const tauScale = tauMs / LIST_RATE_TAU_MS;
    const scaleRate = (r: DecayScore): DecayScore => ({
      score: r.score * tauScale,
      lastMs: r.lastMs,
    });

    // Pass 1 (post-order): recurse into children FIRST so that when seedTopic
    // runs for a topic that both publishes and has subtopics, its child nodes
    // already exist and it is correctly treated as a non-leaf (its own rate
    // isn't over-seeded from the subtree aggregate).
    const walk = (d: MqttData) => {
      for (const key of Object.keys(d)) {
        const n = d[key];
        walk(n.children);
        // Only nodes that actually published get their own count/rate; parents
        // carry a propagated latestMessageTime but no own message. seedTopic
        // still creates the ancestor path and folds this topic's own count into
        // every ancestor's aggCount, so each level ends equal to the List's
        // subtree-cumulative messageCount.
        if (n.message !== undefined) {
          let childMsgs = 0;
          for (const ck of Object.keys(n.children)) {
            childMsgs += n.children[ck].messageCount;
          }
          const ownMsgs = n.messageCount - childMsgs;
          const lastMs = n.latestMessageTime
            ? new Date(n.latestMessageTime).getTime()
            : Date.now();
          model.seedTopic(
            n.topic,
            ownMsgs,
            lastMs,
            n.rate ? scaleRate(n.rate) : undefined
          );
        }
      }
    };
    walk(data);

    // Pass 2: seed EVERY node's subtree-aggregate rate onto model.agg, not just
    // publisher leaves. The List bumps ancestors too, so each node's rate field
    // is already its subtree aggregate; without this, interior non-publisher
    // nodes keep agg score 0 and the default "Busiest first" sort ranks
    // collapsed namespaces last for ~1 tau after a List -> Graph toggle.
    const walkAgg = (d: MqttData) => {
      for (const key of Object.keys(d)) {
        const n = d[key];
        if (n.rate) model.seedAggRate(n.topic, scaleRate(n.rate));
        walkAgg(n.children);
      }
    };
    walkAgg(data);
  };

  // Canvas colours have to be plain numbers, so the design tokens (CSS
  // variables behind the Tailwind colours) are resolved off the document root
  // and packed to 0xRRGGBB. The theme store flips the class on <html> before
  // it notifies subscribers, so this always reads the theme being applied.
  const parseCssColor = (value: string): number | null => {
    if (!value) return null;
    if (value.startsWith("#")) {
      const hex = value.slice(1);
      const full =
        hex.length === 3
          ? hex
              .split("")
              .map((c) => c + c)
              .join("")
          : hex;
      const n = parseInt(full.slice(0, 6), 16);
      return Number.isNaN(n) ? null : n;
    }
    // rgb()/rgba()/bare "r g b" triplets (the -rgb tokens used with Tailwind
    // opacity modifiers); alpha, if present, is ignored
    const parts = value.match(/[\d.]+/g);
    if (!parts || parts.length < 3) return null;
    const [r, g, b] = parts
      .slice(0, 3)
      .map((p) => Math.max(0, Math.min(255, Math.round(parseFloat(p)))));
    return (r << 16) | (g << 8) | b;
  };

  // `fallback` covers environments with no document styles to read (storybook
  // snapshots, jsdom) — it is never a design decision, always the token's own
  // value for that theme.
  const tokenHex = (token: string, fallback: number): number => {
    try {
      const raw = untypedColors[token]?.["DEFAULT"] ?? "";
      const varName = raw.match(/--[\w-]+/)?.[0];
      const value = varName
        ? getComputedStyle(document.documentElement)
            .getPropertyValue(varName)
            .trim()
        : raw.trim();
      return parseCssColor(value) ?? fallback;
    } catch (e) {
      return fallback;
    }
  };

  const applyTheme = (t: "dark" | "light") => {
    if (!renderer) return;
    const light = t === "light";
    renderer.setEndpoint(light ? COLD_ENDPOINT_LIGHT : COLD_ENDPOINT_DARK);
    renderer.setThemeUi({
      text: tokenHex("secondary-text", light ? 0x5f5f69 : 0xa1a1aa),
      accent: tokenHex("primary", light ? 0x5e6ce0 : 0x7c8cff),
      minimapBg: tokenHex("elevation-0", light ? 0xffffff : 0x020202),
      // no token carries an alpha for this: the minimap floats over the graph,
      // so it stays translucent enough to read nodes through
      minimapBgAlpha: light ? 0.7 : 0.32,
      minimapBorder: tokenHex("divider", light ? 0xb8b8c0 : 0x505050),
      pulse: tokenHex("emphasis", light ? 0x131316 : 0xffffff),
    });
  };
  $: applyTheme($theme);

  // Selection can originate from either side: clicking a node in the graph, or
  // clicking the topic heading in the sidebar. Graph clicks record the topic in
  // lastSyncedTopic up front, so when the store update lands back here it is a
  // no-op. A store value we have NOT seen yet is sidebar-originated: reflect it
  // on the canvas and zoom the graph to the newly-selected topic.
  let lastSyncedTopic: string | null | undefined = undefined;
  const syncExternalSelection = (topic: string | null) => {
    if (!renderer) return;
    if (topic === lastSyncedTopic) return;
    lastSyncedTopic = topic;
    renderer.setSelected(topic);
    if (topic !== null) renderer.focusTopic(topic);
  };
  $: syncExternalSelection($selectedTopicStore.selectedTopic);

  // ---- hover inspector ----
  interface HoverInfo {
    topic: string;
    scope: string;
    rate: string;
    age: string;
    count: number;
    x: number;
    y: number;
  }
  let hover: HoverInfo | null = null;

  const findNode = (topic: string): TopicNode | null => {
    let n = model.root;
    for (const seg of topic.split("/")) {
      const c = n.children.get(seg);
      if (!c) return null;
      n = c;
    }
    return n;
  };

  const formatAge = (lastMs: number, nowMs: number): string => {
    if (!lastMs) return "no messages yet";
    const d = Math.max(0, nowMs - lastMs);
    if (d < 1500) return "just now";
    const s = Math.floor(d / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
  };

  const buildHover = (topic: string, x: number, y: number): HoverInfo | null => {
    const node = findNode(topic);
    if (!node) return null;
    const nowMs = Date.now();
    // mirror the renderer: collapsed parents display the subtree aggregate
    const isAgg = !node.expanded && node.descendantCount > 0;
    const score = isAgg ? model.aggScore(node, nowMs) : model.ownScore(node, nowMs);
    const lastMs = isAgg ? node.aggLastMsg : node.ownLastMsg;
    return {
      topic,
      scope: isAgg
        ? `subtree total · ${node.descendantCount} topics`
        : node.descendantCount > 0
          ? "this topic only"
          : "topic",
      rate: formatRate(rateFromScore(score, model.tauMs)),
      age: formatAge(lastMs, nowMs),
      count: isAgg ? node.aggCount : node.ownCount,
      x,
      y,
    };
  };

  $: tipLeft = hover ? Math.min(hover.x + 14, Math.max(8, containerW - 300)) : 0;
  $: tipTop = hover
    ? hover.y > containerH - 100
      ? hover.y - 88
      : hover.y + 18
    : 0;

  // ---- legend ----
  $: legendGradient = rampCssGradient(
    $theme === "light" ? COLD_ENDPOINT_LIGHT : COLD_ENDPOINT_DARK,
    cvdSafe
  );
  $: cooldownShort = COOLDOWN_SHORT[cooldownMs] ?? `${Math.round(cooldownMs / 1000)}s`;

  // ---- performance stats HUD ----
  // Ingest rate is counted here (in the message-source callback below) rather
  // than in the renderer, since the renderer never sees raw message counts,
  // only model.ingest() calls. A 1s interval reads both that counter and the
  // renderer's getPerfStats() and formats them into readable words for the
  // overlay; cleaned up on destroy like the other intervals in this component.
  interface StatsInfo {
    fps: number;
    maxFps: number;
    avgFrameMs: number;
    visibleNodes: number;
    placedNodes: number;
    ingestPerSec: number;
  }
  let stats: StatsInfo | null = null;
  let statsTimer: number | null = null;
  let ingestCounter = 0;
  // Monotonic arrival count for the live-tick re-sort gate. Deliberately
  // separate from ingestCounter, which the stats HUD zeroes every second and
  // so cannot signal "anything arrived since the last eligible tick".
  let totalIngested = 0;

  const startStatsTimer = () => {
    if (statsTimer !== null) return;
    // the counter has been accumulating since mount; without this the first
    // sample reports everything received since then as one second's traffic
    ingestCounter = 0;
    statsTimer = window.setInterval(() => {
      if (!renderer) return;
      const p = renderer.getPerfStats();
      stats = {
        fps: p.fps,
        maxFps: p.maxFps,
        avgFrameMs: p.avgFrameMs,
        visibleNodes: p.visibleNodes,
        placedNodes: p.placedNodes,
        ingestPerSec: ingestCounter,
      };
      ingestCounter = 0;
    }, 1000);
  };
  const stopStatsTimer = () => {
    if (statsTimer !== null) {
      window.clearInterval(statsTimer);
      statsTimer = null;
    }
    stats = null;
    ingestCounter = 0;
  };
  $: if (statsOn) startStatsTimer();
  else stopStatsTimer();

  // ---- message source (Wails by default; injectable for storybook/dev) ----
  const wailsSource: GraphMessageSource = {
    subscribe: (onMessages, onClear) => {
      const unMsgs = Events.On(connection.eventSet.mqttMessages, (e) => {
        const messages: mqtt.MqttMessage[] = e.data;
        onMessages(messages);
      });
      const unClear = Events.On(connection.eventSet.mqttClearHistory, () =>
        onClear()
      );
      return () => {
        unMsgs();
        unClear();
      };
    },
  };

  // Mirror the shared List search store into filterText (external edits, e.g.
  // typing in the List then toggling here). Guarded so the store->local sync
  // and the local->store push below don't loop.
  onMount(() => {
    if (!searchStore) return;
    unsubSearch = searchStore.subscribe((s) => {
      if (s.text !== filterText) filterText = s.text;
    });
  });
  // Push local edits back out so the List picks them up on the return toggle.
  // Guarded symmetrically with the subscribe above: only push when the value
  // genuinely originated here, else a store-driven filterText change would
  // bounce straight back into the store.
  $: if (searchStore && get(searchStore).text !== filterText)
    searchStore.setSearchText(filterText);

  // ---- live re-sort tick ----
  // Paused whenever the canvas is off screen (see setOnScreen): a hidden
  // connection tab keeps this component mounted, and a full re-sort relayout
  // every 1.2s per hidden connection is pure waste.
  let liveTick = 0;
  let lastTickIngest = 0;
  const startLiveTimer = () => {
    if (liveTimer !== null || destroyed) return;
    liveTimer = window.setInterval(() => {
      if (!renderer) return;
      renderer.notifyData();
      liveTick++;
      // On big trees the periodic re-sort relayout (a full d3-hierarchy pass +
      // visual reconciliation) is too expensive to run every 1.2s tick, so it
      // only runs every 4th tick (~5s) once the tree crosses 2000 topics.
      const dueThisTick = model.topicCount <= 2000 || liveTick % 4 === 0;
      // rate/recency drift continuously between arrivals via decay-driven node
      // sizing, so their sibling order always needs the periodic relayout to
      // track the List. stale/msgs only change when a message actually arrives,
      // so skip their relayout on idle ticks (no batch since the last tick).
      // alpha/count don't drift at all: alpha never reorders existing nodes, and
      // topic-count changes bump structureGen -> visibleDirty -> notifyData
      // relayouts on their own.
      // Only consume the arrival signal on ticks where a relayout could
      // actually run: on throttled big trees (or while paused) arrivals must
      // stay pending until the next eligible tick, not be forgotten.
      if (!paused && dueThisTick) {
        const ingestedSinceLastTick = totalIngested !== lastTickIngest;
        lastTickIngest = totalIngested;
        const needsRelayout =
          sortKey === "rate" ||
          sortKey === "recency" ||
          ((sortKey === "stale" || sortKey === "msgs") && ingestedSinceLastTick);
        if (needsRelayout) {
          renderer.relayout();
        }
      }
      // topic count drives the "no topics yet" state; it can grow without a
      // relayout when arrivals land under collapsed nodes
      topicCount = model.topicCount;
      // keep the hover inspector's numbers live while the pointer rests
      if (hover) hover = buildHover(hover.topic, hover.x, hover.y);
    }, 1200);
  };
  const stopLiveTimer = () => {
    if (liveTimer !== null) {
      window.clearInterval(liveTimer);
      liveTimer = null;
    }
  };

  // Mounted is not the same as on screen: connection tabs hide with
  // display:none, and the List <-> Graph toggle swaps this component out
  // without the browser telling the renderer anything. An IntersectionObserver
  // on the canvas container covers both, so a background connection stops
  // paying for a ticker and a 1.2s relayout it can't be seen doing.
  const setOnScreen = (on: boolean) => {
    if (on === onScreen) return;
    onScreen = on;
    renderer?.setOffscreen(!on);
    if (on) startLiveTimer();
    else stopLiveTimer();
  };

  onMount(async () => {
    loadSettings();
    const w = containerEl.clientWidth || width || 800;
    const h = containerEl.clientHeight || 600;
    const r = new TopicGraphRenderer(model, {
      onSelect: (topic) => {
        renderer?.setSelected(topic);
        lastSyncedTopic = topic;
        if (topic === null) {
          selectedTopicStore.deselectTopic();
        } else if ($selectedTopicStore.selectedTopic !== topic) {
          selectedTopicStore.selectTopic(topic);
        }
      },
      onHover: (topic, x, y) => {
        hover = topic ? buildHover(topic, x, y) : null;
      },
      onLayout: (n) => {
        placedNodes = n;
        topicCount = model.topicCount;
      },
    });
    renderer = r;
    await r.init(canvasEl, w, h);
    // A fast List <-> Graph toggle can unmount this component while init() is
    // still resolving. Everything below outlives the component if it runs
    // after that: the message subscription in particular would leave an orphan
    // model ingesting every message for the rest of the session.
    if (destroyed) {
      r.destroy();
      renderer = null;
      return;
    }
    applyTheme($theme);
    applySettings();
    seed(initialData);

    // pick up where the user left off before the last toggle; a first visit
    // (nothing saved) starts fully collapsed at the roots
    const saved = expansionByConnection.get(connectionKey());
    if (saved && saved.size > 0) r.restoreExpansion(saved);
    else r.expandToDepth(0);

    const selected = $selectedTopicStore.selectedTopic;
    r.setSelected(selected);
    // seed the "already synced" state so the reactive sync below doesn't treat
    // this initial mount value as an external change and zoom a second time
    lastSyncedTopic = selected;
    // Arriving with a topic already selected (picked it in the List, then
    // switched here) should reveal it: expand its ancestors and ease onto it,
    // once. With nothing selected there's nothing to reveal, so the cold-start
    // framing stands.
    revealedOnMount = selected ? r.focusTopic(selected) : false;
    // skip the whole-tree fit if the seed was already big enough to trigger
    // the one-shot initial view (top rows of sort order) — fitView() here
    // would otherwise immediately zoom back out to the illegible whole tree
    if (!revealedOnMount && !r.hasAppliedInitialView()) r.fitView();

    unsubSource = (messageSource ?? wailsSource).subscribe(
      (msgs) => {
        ingestCounter += msgs.length;
        totalIngested += msgs.length;
        for (const m of msgs) model.ingest(m.topic, m.timeMs || Date.now());
      },
      () => {
        model.clear();
        renderer?.relayout();
      }
    );

    startLiveTimer();

    // Panel-drag resize: a ResizeObserver can fire many times per drag frame.
    // Pause the ticker immediately on every event (beginResize), but only
    // reallocate the canvas backing store once, on the trailing edge of a
    // ~150ms debounce, using the latest observed dimensions.
    ro = new ResizeObserver(() => {
      const cw = containerEl.clientWidth;
      const ch = containerEl.clientHeight;
      if (cw <= 0 || ch <= 0 || !renderer) return;
      renderer.beginResize();
      if (resizeDebounce !== null) window.clearTimeout(resizeDebounce);
      resizeDebounce = window.setTimeout(() => {
        resizeDebounce = null;
        if (!renderer) return;
        renderer.endResize(cw, ch);
        if (!everSized) {
          everSized = true;
          if (!revealedOnMount && !renderer.hasAppliedInitialView())
            renderer.fitView();
        }
      }, 150);
    });
    ro.observe(containerEl);

    io = new IntersectionObserver(
      (entries) => {
        // A document the browser isn't rendering at all (window minimised,
        // page backgrounded) stops computing intersections and reports every
        // element as not intersecting. Taking that at face value would park
        // the graph and never hear a correction, since no further intersection
        // change is reported until rendering resumes. document.hidden already
        // stops the ticker for that case, so ignore the observer here.
        if (document.hidden) return;
        setOnScreen(entries.some((e) => e.isIntersecting));
      },
      { threshold: 0 }
    );
    io.observe(containerEl);

    document.addEventListener("fullscreenchange", onFullscreenChange);
  });

  onDestroy(() => {
    destroyed = true;
    // hand the current expansion to the next mount of this connection
    if (renderer) {
      expansionByConnection.set(connectionKey(), renderer.expandedTopics());
    }
    unsubSource?.();
    unsubSearch?.();
    ro?.disconnect();
    io?.disconnect();
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    stopLiveTimer();
    stopStatsTimer();
    // a pending trailing resize would otherwise fire into a destroyed renderer
    if (resizeDebounce !== null) {
      window.clearTimeout(resizeDebounce);
      resizeDebounce = null;
    }
    // cancel the trailing 150ms filter call so it can't touch a destroyed renderer
    applyFilter.cancel();
    renderer?.destroy();
    renderer = null;
  });

  // debounced filter (matches the list view's search behaviour)
  const applyFilter = _.debounce((t: string) => renderer?.setFilter(t), 150);
  $: {
    if (filterText === "") {
      applyFilter.cancel();
      renderer?.setFilter("");
    } else {
      applyFilter(filterText);
    }
  }

  const setSort = (key: SortKey) => {
    sortKey = key;
    renderer?.setSort(key);
    saveSettings();
  };
  const setDepth = (d: number) => {
    renderer?.expandToDepth(d);
    renderer?.fitView();
  };
  const toggleExpandAll = () => {
    allExpanded = !allExpanded;
    // collapse returns to the fully-collapsed initial state (roots only)
    setDepth(allExpanded ? 99 : 0);
  };
  const togglePause = () => {
    paused = !paused;
  };
  const toggleMinimap = () => {
    minimapOn = !minimapOn;
    renderer?.setMinimapVisible(minimapOn);
    saveSettings();
  };
  const toggleFollow = () => {
    followHottest = !followHottest;
    renderer?.setFollowHottest(followHottest);
    saveSettings();
  };
  const toggleCvd = () => {
    cvdSafe = !cvdSafe;
    renderer?.setCvdSafe(cvdSafe);
    saveSettings();
  };
  const toggleLegend = () => {
    legendOn = !legendOn;
    saveSettings();
  };
  const toggleStats = () => {
    statsOn = !statsOn;
    saveSettings();
  };
  const setCooldown = (ms: number) => {
    cooldownMs = ms;
    renderer?.setCooldownMs(ms);
    saveSettings();
  };
  const setSmoothing = (ms: number) => {
    tauMs = ms;
    // rescales the accumulated scores, so the reported rates and the node
    // radii stay put and only the smoothing changes
    model.setTau(ms);
    renderer?.requestRepaint();
    saveSettings();
  };
  const setMaxNodeSize = (r: number) => {
    maxNodeR = r;
    renderer?.setMaxNodeSize(r);
    saveSettings();
  };
  const toggleFullscreen = () => {
    const el = containerEl?.parentElement ?? containerEl;
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  const onFullscreenChange = () => {
    // the container resizes when entering/leaving fullscreen; refit once settled
    requestAnimationFrame(() => {
      const cw = containerEl?.clientWidth ?? 0;
      const ch = containerEl?.clientHeight ?? 0;
      if (cw > 0 && ch > 0 && renderer) {
        renderer.resize(cw, ch);
        renderer.fitView();
      }
    });
  };

  const filterFieldColor = untypedColors["outline"]["DEFAULT"];

  // A blank canvas reads as broken. Say which kind of nothing it is instead.
  $: emptyMessage =
    topicCount === 0
      ? "No topics yet"
      : placedNodes === 0 && filterText.trim() !== ""
        ? "No topics match"
        : null;
</script>

<div class="flex h-full w-full min-w-0 flex-col bg-elevation-0">
  <PanelHeader class="bg-elevation-0 shrink-0">
    <div
      class="flex h-full flex-row items-center gap-2 overflow-hidden px-2 text-emphasis"
    >
      <slot name="leading" />
      <div class="max-w-[280px] flex-grow">
        <BaseInput
          name={`topic-graph-filter-${connection.connectionDetails.id}`}
          icon="search"
          placeholder="Filter topics"
          bgColor={filterFieldColor}
          bgHoverColor="var(--color-hovered)"
          bind:value={filterText}
        />
      </div>
      <Tooltip placement="bottom">
        <DropdownMenu triggerText={SORT_LABELS[sortKey]} triggerClass="w-[125px]">
          <div class="flex flex-col" slot="menu-content">
            {#each Object.entries(SORT_LABELS) as [key, label]}
              <DropdownMenuItem
                isSelected={sortKey === key}
                onClick={() => setSort(key as SortKey)}>{label}</DropdownMenuItem
              >
            {/each}
          </div>
        </DropdownMenu>
        <span slot="tooltip-content">Sort sibling topics</span>
      </Tooltip>
      <div bind:this={pauseWrapEl}>
        <Tooltip placement="bottom">
          <Button
            class={paused ? "text-primary" : ""}
            on:click={togglePause}
          >
            <Icon type={paused ? "connect" : "pause"} width={20} height={20} />
          </Button>
          <span slot="tooltip-content"
            >{paused ? "Resume live re-sorting" : "Pause live re-sorting"}</span
          >
        </Tooltip>
      </div>
      <Tooltip placement="bottom">
        <Button on:click={toggleExpandAll}>
          <Icon type={allExpanded ? "collapse" : "expand"} width={20} height={20} />
        </Button>
        <span slot="tooltip-content">Expand/Collapse all topics</span>
      </Tooltip>
      <Tooltip placement="bottom">
        <Button on:click={() => renderer?.fitView()}>
          <Icon type="fit" width={20} height={20} />
        </Button>
        <span slot="tooltip-content">Fit graph to view</span>
      </Tooltip>
      <DropdownMenu>
        <span slot="trigger">
          <Button variant="secondary" iconType="settings" iconSize={16}></Button>
        </span>
        <div class="flex w-[200px] flex-col" slot="menu-content">
          <span class="px-2 pb-0.5 pt-1 text-xs text-secondary-text"
            >Recency window</span
          >
          {#each COOLDOWNS as [lbl, ms]}
            <DropdownMenuItem
              isSelected={cooldownMs === ms}
              onClick={() => setCooldown(ms)}>{lbl}</DropdownMenuItem
            >
          {/each}
          <span class="px-2 pb-0.5 pt-2 text-xs text-secondary-text"
            >Rate smoothing</span
          >
          {#each SMOOTHING as [lbl, ms]}
            <DropdownMenuItem
              isSelected={tauMs === ms}
              onClick={() => setSmoothing(ms)}>{lbl}</DropdownMenuItem
            >
          {/each}
          <span class="px-2 pb-0.5 pt-2 text-xs text-secondary-text"
            >Max node size</span
          >
          {#each MAX_NODE_SIZES as [lbl, r]}
            <DropdownMenuItem
              isSelected={maxNodeR === r}
              onClick={() => setMaxNodeSize(r)}>{lbl}</DropdownMenuItem
            >
          {/each}
          <span class="px-2 pb-0.5 pt-2 text-xs text-secondary-text">Display</span>
          <DropdownMenuItem onClick={toggleMinimap}>
            <span class="flex items-center gap-2">
              <Icon type={minimapOn ? "ticked" : "unticked"} size={14} />Minimap
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleLegend}>
            <span class="flex items-center gap-2">
              <Icon type={legendOn ? "ticked" : "unticked"} size={14} />Legend
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleStats}>
            <span class="flex items-center gap-2">
              <Icon type={statsOn ? "ticked" : "unticked"} size={14} />Performance
              stats
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleFollow}>
            <span class="flex items-center gap-2">
              <Icon type={followHottest ? "ticked" : "unticked"} size={14} />Follow
              hottest topic
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleCvd}>
            <span class="flex items-center gap-2">
              <Icon type={cvdSafe ? "ticked" : "unticked"} size={14} />Colour-blind
              safe palette
            </span>
          </DropdownMenuItem>
        </div>
      </DropdownMenu>
      <div class="ml-auto">
        <Tooltip placement="bottom">
          <Button on:click={toggleFullscreen}>
            <Icon type="fullscreen" width={20} height={20} />
          </Button>
          <span slot="tooltip-content">Fullscreen</span>
        </Tooltip>
      </div>
    </div>
  </PanelHeader>
  <div
    bind:this={containerEl}
    bind:clientWidth={containerW}
    bind:clientHeight={containerH}
    class="relative min-h-0 w-full grow bg-elevation-0"
  >
    <canvas bind:this={canvasEl} class="block h-full w-full"></canvas>
    {#if emptyMessage}
      <div
        class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-secondary-text"
      >
        {emptyMessage}
      </div>
    {/if}
    {#if paused}
      <div
        class="pointer-events-none absolute top-1 rounded border border-outline bg-elevation-1 px-1.5 py-0.5 text-xs text-secondary-text"
        style:left={`${pausedNoteLeft}px`}
      >
        Sorting paused
      </div>
    {/if}
    {#if hover}
      <div
        class="pointer-events-none absolute z-20 max-w-[290px] rounded bg-elevation-2 px-2.5 py-1.5 text-xs shadow"
        style:left={`${tipLeft}px`}
        style:top={`${tipTop}px`}
      >
        <div class="break-all font-medium text-emphasis">{hover.topic}</div>
        <div class="text-secondary-text">{hover.scope}</div>
        <div class="flex gap-3 text-white-text">
          <span>{hover.rate}</span>
          <span>{hover.age}</span>
          <span>{hover.count.toLocaleString()} msgs</span>
        </div>
      </div>
    {/if}
    {#if legendOn}
      <div
        class="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5 rounded border border-outline bg-elevation-1 bg-opacity-85 px-2.5 py-2 text-xs text-secondary-text"
      >
        <div class="flex items-center gap-2">
          <span>now</span>
          <div
            class="h-1.5 w-24 rounded-full"
            style:background={legendGradient}
          ></div>
          <span>idle {cooldownShort}+</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1">
            <div class="size-1.5 rounded-full bg-secondary-text"></div>
            <div class="size-2.5 rounded-full bg-secondary-text"></div>
            <div class="size-3.5 rounded-full bg-secondary-text"></div>
          </div>
          <span>size = msg rate · ring = collapsed subtree</span>
        </div>
      </div>
    {/if}
    {#if statsOn && stats}
      <div
        class="pointer-events-none absolute right-3 top-3 flex flex-col gap-1 rounded border border-outline bg-elevation-1 px-2.5 py-2 text-xs text-secondary-text"
      >
        <div>{stats.fps} fps (cap {stats.maxFps})</div>
        <div>avg frame {stats.avgFrameMs} ms</div>
        <div>
          nodes {stats.visibleNodes.toLocaleString()}/{stats.placedNodes.toLocaleString()}
          visible
        </div>
        <div>ingest {stats.ingestPerSec.toLocaleString()} msg/s</div>
      </div>
    {/if}
  </div>
</div>
