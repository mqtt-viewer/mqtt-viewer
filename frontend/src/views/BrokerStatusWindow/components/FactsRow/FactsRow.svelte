<script lang="ts">
  // One-line broker facts under the gauges: broker/version, uptime, session
  // counts with word labels, and average message size. Each part is omitted when
  // its metric has no data, so a sparse broker shows a shorter line rather than
  // "unknown" placeholders. Values come from the store's metricByKey.
  import { humanizeDuration, formatMetricValue } from "../../sys-metrics";

  export let version: string | null = null;
  export let uptimeSeconds: number | null = null;
  export let clientsConnected: number | null = null;
  export let clientsDisconnected: number | null = null;
  export let clientsExpired: number | null = null;
  export let avgMsgSize: number | null = null;

  // Session counts, each dropped when its metric is absent: "17 live, 6 offline".
  $: sessionParts = [
    clientsConnected !== null ? `${formatMetricValue(clientsConnected)} live` : null,
    clientsDisconnected !== null
      ? `${formatMetricValue(clientsDisconnected)} offline`
      : null,
    clientsExpired !== null ? `${formatMetricValue(clientsExpired)} expired` : null,
  ].filter((p): p is string => p !== null);

  $: parts = [
    version,
    uptimeSeconds !== null ? `up ${humanizeDuration(uptimeSeconds)}` : null,
    sessionParts.length > 0 ? sessionParts.join(", ") : null,
    avgMsgSize !== null ? `${formatMetricValue(avgMsgSize)} B avg` : null,
  ].filter((p): p is string => p !== null);
</script>

{#if parts.length > 0}
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-secondary-text">
    {#each parts as part, i (i)}
      {#if i > 0}
        <span class="opacity-50" aria-hidden="true">·</span>
      {/if}
      <span>{part}</span>
    {/each}
  </div>
{/if}
