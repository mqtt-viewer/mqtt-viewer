<script lang="ts">
  import Icon from "@/components/Icon/Icon.svelte";
  import IconButton from "@/components/Button/IconButton.svelte";
  import type { ChartSeriesStore } from "./chart-series-store";

  export let chartSeriesStore: ChartSeriesStore;
  export let topic: string;
  export let onAddFromPayload: (() => void) | null = null;
</script>

<div class="flex flex-col gap-1">
  <span class="text-sm font-semibold text-secondary-text h-5 flex items-end"
    >Series</span
  >
  {#each $chartSeriesStore as series (series.path)}
    <div class="flex items-center gap-2 py-1 min-w-0">
      <span
        class="size-3 min-w-3 rounded-[2px]"
        style:background-color={series.visible ? series.color : "transparent"}
        style:border={`1px solid ${series.color}`}
      ></span>
      <div class="min-w-0 grow">
        <div class="text-base text-emphasis truncate">{series.label}</div>
        <div class="text-sm text-secondary-text truncate">
          {topic}{series.path ? `  ·  ${series.path}` : ""}
        </div>
      </div>
      <IconButton
        tooltipText={series.visible ? "Hide" : "Show"}
        onClick={() => chartSeriesStore.setVisible(series.path, !series.visible)}
      >
        <Icon type={series.visible ? "show" : "hide"} size={15} />
      </IconButton>
      <IconButton
        tooltipText="Remove"
        onClick={() => chartSeriesStore.removeSeries(series.path)}
      >
        <Icon type="close" size={14} />
      </IconButton>
    </div>
  {/each}
  {#if onAddFromPayload}
    <button
      class="flex items-center gap-1 text-base text-primary py-1 w-fit"
      on:click={onAddFromPayload}
    >
      <Icon type="plus" size={14} /> Add value from payload
    </button>
  {/if}
</div>
