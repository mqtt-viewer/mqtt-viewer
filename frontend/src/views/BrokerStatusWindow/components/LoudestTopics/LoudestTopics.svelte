<script lang="ts">
  // Client-side "loudest topics" table for the broker-status window. Renders the
  // top rows the store merged over the selected range, each with msg/s, bytes/s
  // and a share bar. The section is collapsible and starts collapsed, with the
  // loudest topic and its rate summarised in the header. Topics keep their last
  // two segments and ellipsise the head, with the full topic in a tooltip and a
  // copy button on row hover. Overflow beyond the shown rows is a single footer
  // line, never a row. At narrow container widths the share bar drops first,
  // then bytes/s.
  import Icon from "@/components/Icon/Icon.svelte";
  import CopyToClipboard from "@/components/CopyToClipboard/CopyToClipboard.svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";
  import { formatMetricValue } from "../../sys-metrics";
  import type { LoudestState } from "../../broker-status-store";

  export let loudest: LoudestState = {
    rows: [],
    overflowTopics: 0,
    overflowMsgPerSec: 0,
    collecting: true,
  };

  // Open state lives here so a story can force the section open. Per session:
  // nothing is persisted, so every window starts collapsed.
  export let expanded = false;

  // Width breakpoints (px) for the responsive column drops. Measured off the
  // container so the table adapts to the pane, not the viewport.
  const SHARE_BAR_MIN = 380;
  const BYTES_MIN = 280;

  let containerWidth = 640;
  $: showShareBar = containerWidth >= SHARE_BAR_MIN;
  $: showBytes = containerWidth >= BYTES_MIN;

  // Loudest row sets the bar's full width; the rest scale against it.
  $: peak = loudest.rows.reduce((m, r) => Math.max(m, r.msgPerSec), 0);

  // Splits a topic for the row's CSS truncation contract: the head span gets
  // `min-w-0 truncate` so it is the part that ellipsises, the tail span gets
  // `shrink-0` so the last two segments (the bit that identifies the topic)
  // always survive. No measurement anywhere, so the full topic renders whenever
  // it fits. Two segments or fewer are all tail.
  export const splitTopic = (topic: string): { head: string; tail: string } => {
    const parts = topic.split("/");
    if (parts.length <= 2) return { head: "", tail: topic };
    return {
      head: parts.slice(0, -2).join("/"),
      tail: `/${parts.slice(-2).join("/")}`,
    };
  };

  // Collapsed header summary. Names the loudest topic and its rate, never a
  // topic count: overflowTopics is not a usable total (see the footer note).
  $: topRow =
    loudest.rows.length > 0
      ? loudest.rows.reduce((best, r) => (r.msgPerSec > best.msgPerSec ? r : best))
      : undefined;
  $: summary = topRow
    ? `(${topRow.topic} ${formatMetricValue(topRow.msgPerSec)}/s)`
    : "(nothing yet)";

  // The footer names the exact unattributed rate, never a topic count: the
  // per-second top-K capture and the admission cap both discard topics without
  // counting them, so no honest total is available here.
  $: hasOverflow = loudest.overflowTopics > 0 || loudest.overflowMsgPerSec > 0;
</script>

<div
  class="flex flex-col rounded border border-outline bg-elevation-1"
  bind:clientWidth={containerWidth}
>
  <button
    type="button"
    class="flex items-center gap-2 px-3 py-2 text-secondary-text transition-colors hover:text-emphasis"
    on:click={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="inline-flex transition-transform {expanded ? 'rotate-90' : ''}">
      <Icon type="right" size={16} />
    </span>
    <span>Loudest topics</span>
    {#if expanded}
      <span class="text-sm opacity-70">(this client's subscriptions)</span>
      <!-- Suppressed while the table is empty: the body already says no
           messages have arrived, and two stacked suffixes read as clutter. -->
      {#if loudest.collecting && loudest.rows.length > 0}
        <span class="text-sm opacity-70">(collecting)</span>
      {/if}
    {:else}
      <span class="min-w-0 truncate text-sm opacity-70">{summary}</span>
    {/if}
  </button>

  {#if expanded}
    <div class="flex flex-col gap-2 border-t border-outline p-3">
      {#if loudest.rows.length === 0}
        <span class="py-2 text-sm text-secondary-text">No messages received yet.</span>
      {:else}
        <div class="flex flex-col">
          {#each loudest.rows as row (row.topic)}
            {@const parts = splitTopic(row.topic)}
            <div
              class="group flex items-center gap-3 border-t border-divider py-1 first:border-t-0"
            >
              <div class="flex min-w-0 flex-1 items-center gap-1">
                <!-- Shrinks to the name (no flex-1), so the copy button sits
                     against the topic rather than out at the column edge. -->
                <Tooltip text={row.topic} placement="top" class="min-w-0">
                  <span class="flex min-w-0 overflow-hidden text-sm text-emphasis">
                    {#if parts.head}
                      <span class="min-w-0 truncate">{parts.head}</span>
                    {/if}
                    <!-- The head absorbs every bit of shrink, so the leaf
                         survives whatever the width. With no head there is
                         nothing to protect, so the tail ellipsises itself
                         instead of being clipped by the cell. -->
                    <span class={parts.head ? "shrink-0 truncate" : "min-w-0 truncate"}
                      >{parts.tail}</span
                    >
                  </span>
                </Tooltip>
                <!-- Fixed-width box so revealing the copy button on hover moves
                     nothing. -->
                <span class="w-5 shrink-0">
                  <CopyToClipboard
                    text={row.topic}
                    size={14}
                    tooltipText="Copy topic"
                    class="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                  />
                </span>
              </div>
              <span
                class="w-16 shrink-0 text-right font-mono text-sm tabular-nums text-secondary-text"
              >
                {formatMetricValue(row.msgPerSec)}/s
              </span>
              {#if showBytes}
                <span
                  class="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-secondary-text"
                >
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
            Other topics, {formatMetricValue(loudest.overflowMsgPerSec)} msg/s
          </span>
        {/if}
      {/if}
    </div>
  {/if}
</div>
