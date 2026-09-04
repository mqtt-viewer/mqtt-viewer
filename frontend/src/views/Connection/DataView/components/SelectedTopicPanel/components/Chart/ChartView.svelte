<script lang="ts">
  import { onMount } from "svelte";
  import { get, writable, type Writable } from "svelte/store";
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import { addToast } from "@/components/Toast/Toast.svelte";
  import chartWindows from "@/stores/chart-windows";
  import type { SelectedTopicStore } from "../../../../stores/selected-topic-store";
  import type { ChartSeriesStore } from "./chart-series-store";
  import type { ChartViewOptions } from "../../../../stores/topic-panel-view-state";
  import TopicChart from "./TopicChart.svelte";
  import SeriesLegend from "./SeriesLegend.svelte";
  import ChartOptions from "./ChartOptions.svelte";

  export let selectedTopicStore: SelectedTopicStore;
  export let chartSeriesStore: ChartSeriesStore;
  export let topic: string;
  export let onAddFromPayload: (() => void) | null = null;
  // Pop-out control (shown in the docked panel, hidden in a popped-out window).
  export let onPopOut: (() => void) | null = null;
  // Whether the chart is actually on screen (the docked panel renders every
  // tab slot, hidden or not). Gates TopicChart's 1 Hz window ticker. The
  // pop-out window never passes it, so it defaults to visible there.
  export let visible = true;
  // Owned by the panel so the controls survive a dock switch, which remounts
  // the panel. The pop-out chart window and the stories own no panel state,
  // so they fall back to a local store.
  export let optionsStore: Writable<ChartViewOptions> | null = null;

  const options =
    optionsStore ??
    writable<ChartViewOptions>({
      paused: false,
      style: "line",
      showPoints: true,
    });
  let windowSeconds = 0;

  // ChartView is the shared host for both the docked chart and the pop-out
  // (ChartWindow.svelte renders this component and owns no window state of
  // its own). The pop-out never runs stores/initialization.ts, so the
  // per-connection window store is loaded on demand here via its idempotent
  // init(). The chart subtree (ChartOptions + TopicChart) is held back until
  // the persisted value has been seeded, so ChartOptions/its custom field
  // never mount with a default 0 that would then seed asynchronously.
  let ready = false;

  onMount(async () => {
    try {
      await chartWindows.init();
      windowSeconds = chartWindows.get(get(selectedTopicStore).connectionId);
    } catch (e) {
      // A failed load must not blank the chart: fall back to All history
      // (windowSeconds stays 0) and render regardless.
      console.error("Failed to load chart window preference", e);
    } finally {
      ready = true;
    }
  });

  // Fires only from a genuine user action inside ChartOptions (a preset
  // click or a custom-field edit) -- never for the initial seed above. There
  // is deliberately no reactive statement mirroring windowSeconds into a
  // write here: that would also fire on the seed assignment and clobber a
  // saved value with 0, and could loop.
  const onWindowSecondsChange = (seconds: number) => {
    // The chart itself already shows the new window (local state); only the
    // persistence write can fail, so surface that without touching the view.
    chartWindows.set(get(selectedTopicStore).connectionId, seconds).catch((e) => {
      console.error("Failed to save chart window preference", e);
      addToast({
        data: {
          title: "Chart time window",
          description: "Could not save the time window. It will reset on restart.",
          type: "error",
        },
      });
    });
  };
</script>

<div class="flex flex-col size-full min-h-0">
  <div class="flex items-center gap-1 pb-1">
    <Tooltip
      text={$options.paused ? "Resume live updates" : "Pause live updates"}
      focusable
    >
      <IconButton onClick={() => ($options.paused = !$options.paused)}>
        <span class={$options.paused ? "text-primary" : ""}>
          <Icon type={$options.paused ? "connect" : "pause"} size={16} />
        </span>
      </IconButton>
    </Tooltip>
    {#if ready}
      <ChartOptions
        bind:style={$options.style}
        bind:showPoints={$options.showPoints}
        bind:windowSeconds
        {onWindowSecondsChange}
      />
    {/if}
    {#if onPopOut}
      <Tooltip text="Open in a new window" focusable>
        <IconButton onClick={onPopOut}>
          <Icon type="popOut" size={15} />
        </IconButton>
      </Tooltip>
    {/if}
    <div class="grow"></div>
    {#if $options.paused}
      <span class="text-sm text-primary">Paused</span>
    {/if}
  </div>

  <div
    class="grow min-h-[160px] rounded-sm border border-outline bg-elevation-0 p-1"
  >
    {#if ready}
      <TopicChart
        {selectedTopicStore}
        {chartSeriesStore}
        paused={$options.paused}
        style={$options.style}
        showPoints={$options.showPoints}
        {windowSeconds}
        {visible}
      />
    {/if}
  </div>

  <div class="mt-3 overflow-y-auto">
    <SeriesLegend {chartSeriesStore} {topic} {onAddFromPayload} />
  </div>
</div>
