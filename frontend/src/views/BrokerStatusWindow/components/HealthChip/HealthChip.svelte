<script lang="ts">
  // One health-strip chip: a state dot, label, monospaced value, and a one-word
  // qualifier. State is never carried by colour alone (docs/broker-status-v2
  // spec): ok is an outline dot with no qualifier; attention is a filled warning
  // dot plus a qualifier; problem is a filled error dot plus a qualifier.
  // Informational chips (heap, churn) carry no dot. A stale chip keeps its value
  // but drops the dot and qualifier (greyed, like the header pill).
  import type { HealthLevel } from "../../health";

  export let label: string;
  // null for informational chips (no state dot).
  export let level: HealthLevel | null = null;
  export let informational = false;
  // One-word qualifier ("rising", "present", ...); "" hides it.
  export let qualifier = "";
  // Preformatted, monospaced value (units and peak already composed by caller).
  export let valueText = "";
  // Source has gone silent past the stale threshold: keep value, drop dot.
  export let stale = false;

  // The dot renders for state chips that are neither informational nor stale.
  $: showDot = !informational && !stale && level !== null;
  $: showQualifier = !stale && qualifier !== "";
</script>

<div
  class="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-outline bg-elevation-1 px-2 py-1"
>
  {#if showDot}
    <span
      class="size-2 shrink-0 rounded-full {level === 'problem'
        ? 'bg-error'
        : level === 'attention'
          ? 'bg-warning'
          : 'border border-secondary-text'}"
      aria-hidden="true"
    ></span>
  {/if}
  <span class="text-sm text-secondary-text">{label}</span>
  <span
    class="font-mono text-sm tabular-nums {stale ? 'text-secondary-text' : 'text-emphasis'}"
  >
    {valueText}
  </span>
  {#if showQualifier}
    <span
      class="text-xs {level === 'problem'
        ? 'text-error'
        : level === 'attention'
          ? 'text-warning'
          : 'text-secondary-text'}"
    >
      {qualifier}
    </span>
  {/if}
</div>
