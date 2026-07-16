<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import type { SelectedTopicStore } from "../../../../stores/selected-topic-store";
  import type { ChartSeriesStore } from "./chart-series-store";
  import TopicChart from "./TopicChart.svelte";
  import SeriesLegend from "./SeriesLegend.svelte";
  import ChartOptions from "./ChartOptions.svelte";

  export let selectedTopicStore: SelectedTopicStore;
  export let chartSeriesStore: ChartSeriesStore;
  export let topic: string;
  export let onAddFromPayload: (() => void) | null = null;
  // Pop-out control (shown in the docked panel, hidden in a popped-out window).
  export let onPopOut: (() => void) | null = null;
  // Forwarded to TopicChart: true once the Chart tab is genuinely visible, so
  // the full-payload fetch only happens when the user actually looks at the
  // chart. Defaults to true so a popped-out chart window (which has no tabs
  // to hide behind) always fetches.
  export let isActive = true;

  let paused = false;
  let style: "line" | "area" = "line";
  let showPoints = true;
  let windowMinutes = 0;
</script>

<div class="flex flex-col size-full min-h-0">
  <div class="flex items-center gap-1 pb-1">
    <Tooltip text={paused ? "Resume live updates" : "Pause live updates"}>
      <IconButton onClick={() => (paused = !paused)}>
        <span class={paused ? "text-primary" : ""}>
          <Icon type={paused ? "connect" : "pause"} size={16} />
        </span>
      </IconButton>
    </Tooltip>
    <ChartOptions bind:style bind:showPoints bind:windowMinutes />
    {#if onPopOut}
      <Tooltip text="Open in a new window">
        <IconButton onClick={onPopOut}>
          <Icon type="popOut" size={15} />
        </IconButton>
      </Tooltip>
    {/if}
    <div class="grow"></div>
    {#if paused}
      <span class="text-sm text-primary">Paused</span>
    {/if}
  </div>

  <div
    class="grow min-h-[160px] rounded-sm border border-outline bg-elevation-0 p-1"
  >
    <TopicChart
      {selectedTopicStore}
      {chartSeriesStore}
      {paused}
      {style}
      {showPoints}
      {windowMinutes}
      {isActive}
    />
  </div>

  <div class="mt-3 overflow-y-auto">
    <SeriesLegend {chartSeriesStore} {topic} {onAddFromPayload} />
  </div>
</div>
