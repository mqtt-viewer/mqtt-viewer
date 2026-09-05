<script lang="ts">
  // The broker-status window's second bar: the health chips, then the broker
  // facts (broker/version, uptime, session counts, average message size).
  // Reads the store's evaluated `health` array and renders only the chips that
  // have their minimum samples (chip.render). The bar hides entirely when
  // there are neither chips nor facts; the view decides whether to show a
  // capability notice in its place. Value formatting per chip lives here (the
  // health rules stay pure numbers).
  //
  // Layout: chips and the facts share ONE wrapping flex row, as siblings, so
  // the facts only ever take the room the chips leave over. Every chip is
  // nowrap and the facts line is a single text node, so nothing is squeezed:
  // the facts either sit at the end of the chip line (wide window) or drop
  // whole onto the next line (narrow window), and truncate only when they are
  // wider than the bar itself. Nesting the chips in their own flex box instead
  // would let the facts steal width and rewrap the chips, which is what has to
  // be avoided: the chips are the reason the bar exists. The list wrapper is
  // display:contents so the ARIA list survives that flattening.
  import HealthChip from "../HealthChip/HealthChip.svelte";
  import FactsRow from "../FactsRow/FactsRow.svelte";
  import type { HealthChip as HealthChipData } from "../../health";
  import {
    formatMetricValue,
    hasBrokerFacts,
    type BrokerFacts,
  } from "../../sys-metrics";

  export let health: HealthChipData[] = [];
  // Broker facts, or null on a broker that publishes no $SYS at all. Absent
  // facts simply drop the segment; nothing stands in for it.
  export let facts: BrokerFacts | null = null;

  $: chips = health.filter((c) => c.render);
  $: showFacts = hasBrokerFacts(facts);

  // A positive value that rounds to "0" is shown as "<0.1" instead: a chip
  // reading "Drops 0/s present" contradicts itself and reads as a glitch.
  const displayValue = (value: number): string => {
    const text = formatMetricValue(value);
    return value > 0 && text === "0" ? "<0.1" : text;
  };

  // Composes the monospaced value string for a chip. Heap folds in its peak;
  // rate-like chips carry a "/s" suffix; everything else is a plain count.
  const valueTextFor = (chip: HealthChipData): string => {
    if (chip.value === null) return "";
    const v = displayValue(chip.value);
    if (chip.id === "heap") {
      return chip.detail !== null
        ? `${v} (peak ${displayValue(chip.detail)})`
        : v;
    }
    if (chip.id === "drops" || chip.id === "churn") return `${v}/s`;
    return v;
  };
</script>

<!-- min-h is one chip's height, so the bar is the same height whether it holds
     chips, facts, or both: chips arrive one at a time (each rule renders only
     once it has its minimum samples) and the facts land whenever the broker
     first publishes them, and neither moves the body below. -->
{#if chips.length > 0 || showFacts}
  <div class="flex min-h-[24px] flex-wrap items-center gap-2">
    <div class="contents" role="list" aria-label="Broker health">
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
    {#if showFacts && facts}
      <FactsRow
        version={facts.version}
        uptimeSeconds={facts.uptimeSeconds}
        clientsConnected={facts.clientsConnected}
        clientsDisconnected={facts.clientsDisconnected}
        clientsExpired={facts.clientsExpired}
        avgMsgSize={facts.avgMsgSize}
      />
    {/if}
  </div>
{/if}
