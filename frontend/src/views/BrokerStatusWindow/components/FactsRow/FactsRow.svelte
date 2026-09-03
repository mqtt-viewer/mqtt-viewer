<script lang="ts">
  // One-line broker facts for the broker-status title bar: broker/version,
  // uptime, session counts with word labels, and average message size. Each
  // part is omitted when its metric has no data, so a sparse broker shows a
  // shorter line rather than "unknown" placeholders. Values come from the
  // store's metricByKey.
  //
  // Rendered as one text node joined by middle dots, not a flex row of spans:
  // it sits between the window title and the $SYS pill, so it has to collapse
  // to an ellipsis on a narrow window, and only a single text node truncates.
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
  <span class="min-w-0 truncate text-sm text-secondary-text" title={parts.join(" · ")}>
    {parts.join(" · ")}
  </span>
{/if}
