<script lang="ts">
  // Compact row of health chips at the top of the broker-status body. Reads the
  // store's evaluated `health` array and renders only the chips that have their
  // minimum samples (chip.render). The strip hides entirely when no chip has
  // data; the view decides whether to show a capability notice in its place.
  // Value formatting per chip lives here (the health rules stay pure numbers).
  import HealthChip from "../HealthChip/HealthChip.svelte";
  import type { HealthChip as HealthChipData } from "../../health";
  import { formatMetricValue } from "../../sys-metrics";

  export let health: HealthChipData[] = [];

  $: chips = health.filter((c) => c.render);

  // Composes the monospaced value string for a chip. Heap folds in its peak;
  // rate-like chips carry a "/s" suffix; everything else is a plain count.
  const valueTextFor = (chip: HealthChipData): string => {
    if (chip.value === null) return "";
    const v = formatMetricValue(chip.value);
    if (chip.id === "heap") {
      return chip.detail !== null
        ? `${v} (peak ${formatMetricValue(chip.detail)})`
        : v;
    }
    if (chip.id === "drops" || chip.id === "churn") return `${v}/s`;
    return v;
  };
</script>

{#if chips.length > 0}
  <div
    class="flex flex-wrap items-center gap-2"
    role="list"
    aria-label="Broker health"
  >
    {#each chips as chip (chip.id)}
      <div role="listitem">
        <HealthChip
          label={chip.label}
          level={chip.level}
          informational={chip.informational}
          qualifier={chip.qualifier}
          valueText={valueTextFor(chip)}
          stale={chip.stale}
        />
      </div>
    {/each}
  </div>
{/if}
