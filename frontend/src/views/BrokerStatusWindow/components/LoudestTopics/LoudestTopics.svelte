<script lang="ts">
  // Client-side "loudest topics" table for the broker-status window. Renders the
  // top rows the store merged over the selected range, each with msg/s, bytes/s
  // and a share bar. Topics middle-ellipsise (first segment + last two kept, the
  // full topic in a tooltip). Overflow beyond the shown rows is a single footer
  // line, never a row. At narrow container widths the share bar drops first,
  // then bytes/s.
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import { formatMetricValue } from "../../sys-metrics";
  import type { LoudestState } from "../../broker-status-store";

  export let loudest: LoudestState = {
    rows: [],
    overflowTopics: 0,
    overflowMsgPerSec: 0,
    collecting: true,
  };

  // Width breakpoints (px) for the responsive column drops. Measured off the
  // container so the table adapts to the pane, not the viewport.
  const SHARE_BAR_MIN = 380;
  const BYTES_MIN = 280;

  let containerWidth = 640;
  $: showShareBar = containerWidth >= SHARE_BAR_MIN;
  $: showBytes = containerWidth >= BYTES_MIN;

  // Loudest row sets the bar's full width; the rest scale against it.
  $: peak = loudest.rows.reduce((m, r) => Math.max(m, r.msgPerSec), 0);

  // First segment + last two segments; the full topic lives in the tooltip.
  const middleEllipsis = (topic: string): string => {
    const parts = topic.split("/");
    if (parts.length <= 3) return topic;
    return `${parts[0]}/…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  };

  $: hasOverflow = loudest.overflowTopics > 0;
</script>

<div
  class="flex flex-col gap-2 rounded border border-outline bg-elevation-1 p-3"
  bind:clientWidth={containerWidth}
>
  <div class="flex items-baseline gap-2">
    <span class="text-emphasis">Loudest topics</span>
    <span class="text-sm text-secondary-text">(this client's subscriptions)</span>
    {#if loudest.collecting}
      <span class="text-sm text-secondary-text opacity-70">(collecting)</span>
    {/if}
  </div>

  {#if loudest.rows.length === 0}
    <span class="py-2 text-sm text-secondary-text">No messages received yet.</span>
  {:else}
    <div class="flex flex-col">
      {#each loudest.rows as row (row.topic)}
        <div class="flex items-center gap-3 border-t border-divider py-1 first:border-t-0">
          <Tooltip text={row.topic} placement="top" class="min-w-0 flex-1">
            <span class="block truncate text-sm text-emphasis">
              {middleEllipsis(row.topic)}
            </span>
          </Tooltip>
          <span class="w-16 shrink-0 text-right font-mono text-sm tabular-nums text-secondary-text">
            {formatMetricValue(row.msgPerSec)}/s
          </span>
          {#if showBytes}
            <span class="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-secondary-text">
              {formatMetricValue(row.bytesPerSec)} B/s
            </span>
          {/if}
          {#if showShareBar}
            <span class="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-elevation-2">
              <span
                class="block h-full rounded-full bg-primary opacity-70"
                style:width={`${peak > 0 ? (row.msgPerSec / peak) * 100 : 0}%`}
              ></span>
            </span>
          {/if}
        </div>
      {/each}
    </div>

    {#if hasOverflow}
      <span class="text-sm text-secondary-text opacity-70">
        {loudest.overflowTopics}+ more topics, {formatMetricValue(
          loudest.overflowMsgPerSec
        )} msg/s
      </span>
    {/if}
  {/if}
</div>
