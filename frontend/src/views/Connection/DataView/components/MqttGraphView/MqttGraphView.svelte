<script lang="ts" context="module">
  /** Feed of MQTT message arrivals; defaults to the Wails event stream.
   *  Injectable so storybook / browser harnesses can drive synthetic traffic. */
  export interface GraphMessageSource {
    subscribe: (
      onMessages: (msgs: Array<{ topic: string; timeMs?: number }>) => void,
      onClear: () => void
    ) => () => void;
  }
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
  let liveTimer: number | null = null;
  let everSized = false;

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
  const settingsKey = () =>
    `mqtt-viewer-topicgraph-settings:${connection.connectionDetails.id}`;
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
    model.tauMs = tauMs;
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

  const applyTheme = (t: "dark" | "light") => {
    if (!renderer) return;
    renderer.setEndpoint(t === "light" ? COLD_ENDPOINT_LIGHT : COLD_ENDPOINT_DARK);
    renderer.setThemeUi(
      t === "light"
        ? {
            text: 0x4a4641,
            accent: 0x5e6ce0,
            minimapBg: 0xffffff,
            minimapBgAlpha: 0.7,
            minimapBorder: 0xb8b8c0,
            pulse: 0x2a2a33,
          }
        : {
            text: 0xbdb7b0,
            accent: 0x7c8cff,
            minimapBg: 0x000000,
            minimapBgAlpha: 0.32,
            minimapBorder: 0x8a8a8a,
            pulse: 0xffffff,
          }
    );
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

  const startStatsTimer = () => {
    if (statsTimer !== null) return;
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

  onMount(async () => {
    loadSettings();
    const w = containerEl.clientWidth || width || 800;
    const h = containerEl.clientHeight || 600;
    renderer = new TopicGraphRenderer(model, {
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
    });
    await renderer.init(canvasEl, w, h);
    applyTheme($theme);
    applySettings();
    seed(initialData);
    renderer.expandToDepth(0);
    renderer.setSelected($selectedTopicStore.selectedTopic);
    // seed the "already synced" state so the reactive sync below doesn't treat
    // this initial mount value as an external change and zoom on load
    lastSyncedTopic = $selectedTopicStore.selectedTopic;
    // skip the whole-tree fit if the seed was already big enough to trigger
    // the one-shot initial view (top rows of sort order) — fitView() here
    // would otherwise immediately zoom back out to the illegible whole tree
    if (!renderer.hasAppliedInitialView()) renderer.fitView();

    unsubSource = (messageSource ?? wailsSource).subscribe(
      (msgs) => {
        ingestCounter += msgs.length;
        for (const m of msgs) model.ingest(m.topic, m.timeMs || Date.now());
      },
      () => {
        model.clear();
        renderer?.relayout();
      }
    );

    let liveTick = 0;
    let lastTickIngest = 0;
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
        const ingestedSinceLastTick = ingestCounter !== lastTickIngest;
        lastTickIngest = ingestCounter;
        const needsRelayout =
          sortKey === "rate" ||
          sortKey === "recency" ||
          ((sortKey === "stale" || sortKey === "msgs") && ingestedSinceLastTick);
        if (needsRelayout) {
          renderer.relayout();
        }
      }
      // keep the hover inspector's numbers live while the pointer rests
      if (hover) hover = buildHover(hover.topic, hover.x, hover.y);
    }, 1200);

    // Panel-drag resize: a ResizeObserver can fire many times per drag frame.
    // Pause the ticker immediately on every event (beginResize), but only
    // reallocate the canvas backing store once, on the trailing edge of a
    // ~150ms debounce, using the latest observed dimensions.
    let resizeDebounce: number | null = null;
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
          if (!renderer.hasAppliedInitialView()) renderer.fitView();
        }
      }, 150);
    });
    ro.observe(containerEl);
    document.addEventListener("fullscreenchange", onFullscreenChange);
  });

  onDestroy(() => {
    unsubSource?.();
    unsubSearch?.();
    ro?.disconnect();
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    if (liveTimer) clearInterval(liveTimer);
    stopStatsTimer();
    // cancel the trailing 150ms filter call so it can't touch a destroyed renderer
    applyFilter.cancel();
    renderer?.destroy();
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
    model.tauMs = ms;
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
