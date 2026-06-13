<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Events } from "@wailsio/runtime";
  import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
  import type { Connection } from "@/stores/connections";
  import type { SelectedTopicStore } from "../../stores/selected-topic-store";
  import type { MqttData } from "../MqttDataPanel/stores/mqtt-data";
  import theme from "@/stores/theme";
  import { TopicModel } from "./topic-model";
  import { TopicGraphRenderer } from "./pixi-graph";
  import { COLD_ENDPOINT_DARK, COLD_ENDPOINT_LIGHT } from "./cooldown";
  import type { SortKey } from "./tidy-layout";

  export let connection: Connection;
  export let selectedTopicStore: SelectedTopicStore;
  /** snapshot used once on mount to seed the tree so it isn't empty */
  export let initialData: MqttData = {};
  export let width = 0;

  let canvasEl: HTMLCanvasElement;
  let containerEl: HTMLDivElement;
  const model = new TopicModel();
  let renderer: TopicGraphRenderer | null = null;
  let unsubMsgs: (() => void) | null = null;
  let unsubClear: (() => void) | null = null;
  let ro: ResizeObserver | null = null;
  let liveTimer: number | null = null;
  let everSized = false;

  let filter = "";
  let sortKey: SortKey = "rate";
  let paused = false;
  let depth = 1;

  const seed = (data: MqttData) => {
    const walk = (d: MqttData) => {
      for (const key of Object.keys(d)) {
        const n = d[key];
        const t = n.latestMessageTime
          ? new Date(n.latestMessageTime).getTime()
          : Date.now();
        model.ingest(n.topic, t);
        walk(n.children);
      }
    };
    walk(data);
  };

  const applyTheme = (t: "dark" | "light") => {
    if (!renderer) return;
    renderer.setEndpoint(t === "light" ? COLD_ENDPOINT_LIGHT : COLD_ENDPOINT_DARK);
    renderer.setTextColor(t === "light" ? 0x4a4641 : 0xbdb7b0);
  };
  $: applyTheme($theme);
  $: if (renderer) renderer.setSelected($selectedTopicStore.selectedTopic);

  onMount(async () => {
    const w = containerEl.clientWidth || width || 800;
    const h = containerEl.clientHeight || 600;
    renderer = new TopicGraphRenderer(model, {
      onSelect: (topic) => {
        renderer?.setSelected(topic);
        if ($selectedTopicStore.selectedTopic !== topic) {
          selectedTopicStore.selectTopic(topic);
        }
      },
    });
    await renderer.init(canvasEl, w, h);
    applyTheme($theme);
    seed(initialData);
    renderer.expandToDepth(depth);
    renderer.setSelected($selectedTopicStore.selectedTopic);
    renderer.fitView();

    unsubMsgs = Events.On(connection.eventSet.mqttMessages, (e) => {
      const messages: mqtt.MqttMessage[] = e.data;
      for (const m of messages) model.ingest(m.topic, m.timeMs || Date.now());
    });
    unsubClear = Events.On(connection.eventSet.mqttClearHistory, () => {
      model.clear();
      renderer?.relayout();
    });

    liveTimer = window.setInterval(() => {
      if (!renderer) return;
      renderer.notifyData();
      if (!paused && (sortKey === "rate" || sortKey === "recency")) {
        renderer.relayout();
      }
    }, 1200);

    ro = new ResizeObserver(() => {
      const cw = containerEl.clientWidth;
      const ch = containerEl.clientHeight;
      if (cw <= 0 || ch <= 0 || !renderer) return;
      renderer.resize(cw, ch);
      if (!everSized) {
        everSized = true;
        renderer.fitView();
      }
    });
    ro.observe(containerEl);
  });

  onDestroy(() => {
    unsubMsgs?.();
    unsubClear?.();
    ro?.disconnect();
    if (liveTimer) clearInterval(liveTimer);
    renderer?.destroy();
  });

  const onFilter = (e: Event) => {
    filter = (e.target as HTMLInputElement).value;
    renderer?.setFilter(filter);
  };
  const onSort = (e: Event) => {
    sortKey = (e.target as HTMLSelectElement).value as SortKey;
    renderer?.setSort(sortKey);
  };
  const setDepth = (d: number) => {
    depth = d;
    renderer?.expandToDepth(d);
    renderer?.fitView();
  };
  const togglePause = () => {
    paused = !paused;
  };
  const toggleFullscreen = () => {
    const el = containerEl?.parentElement ?? containerEl;
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
</script>

<div class="flex h-full w-full min-w-0 flex-col bg-elevation-0">
  <div
    class="flex items-center gap-2 border-b border-outline px-3 py-2 text-xs text-secondary-text"
  >
    <input
      class="w-48 rounded-md border border-outline bg-elevation-1 px-2 py-1 text-white-text outline-none"
      placeholder="filter topics…"
      value={filter}
      on:input={onFilter}
    />
    <select
      class="rounded-md border border-outline bg-elevation-1 px-2 py-1 text-white-text outline-none"
      value={sortKey}
      on:change={onSort}
    >
      <option value="rate">sort: rate</option>
      <option value="recency">sort: recency</option>
      <option value="alpha">sort: name</option>
      <option value="count">sort: topics</option>
    </select>
    <button class="rounded-md border border-outline px-2 py-1 hover:text-white-text" on:click={() => setDepth(1)}>collapse</button>
    <button class="rounded-md border border-outline px-2 py-1 hover:text-white-text" on:click={() => setDepth(99)}>expand all</button>
    <button
      class="rounded-md border border-outline px-2 py-1 hover:text-white-text"
      class:text-primary={paused}
      on:click={togglePause}
      title="pause/lock live re-sorting"
    >
      {paused ? "paused" : "live"}
    </button>
    <button class="rounded-md border border-outline px-2 py-1 hover:text-white-text" on:click={() => renderer?.fitView()}>fit</button>
    <button class="ml-auto rounded-md border border-outline px-2 py-1 hover:text-white-text" on:click={toggleFullscreen}>fullscreen</button>
  </div>
  <div bind:this={containerEl} class="relative min-h-0 w-full grow">
    <canvas bind:this={canvasEl} class="block h-full w-full"></canvas>
  </div>
</div>
