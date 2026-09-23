<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";

  type DataView = "list" | "graph" | "sparkplug";

  export let view: DataView;
  export let onChange: (view: DataView) => void;
  /** Adds the Sparkplug option. Only offered once Sparkplug traffic is seen. */
  export let showSparkplug = false;
  /** Open Sparkplug warnings, shown as a count on the Sparkplug option. */
  export let sparkplugWarningCount = 0;

  $: options = (
    [
      { value: "list", label: "List" },
      { value: "graph", label: "Graph" },
      ...(showSparkplug ? [{ value: "sparkplug", label: "Sparkplug" }] : []),
    ] as { value: DataView; label: string }[]
  );
</script>

<Tooltip placement="bottom">
  <div
    class="inline-flex h-[30px] shrink-0 overflow-hidden rounded border border-outline text-xs text-secondary-text"
    role="group"
    aria-label="Data view"
  >
    {#each options as option (option.value)}
      <button
        class={twMerge(
          "px-2.5 transition-colors hover:text-emphasis",
          view === option.value && "bg-elevation-2 text-white-text"
        )}
        aria-pressed={view === option.value}
        on:click={() => onChange(option.value)}
        >{option.label}{#if option.value === "sparkplug" && sparkplugWarningCount > 0}<span
            class="ml-1 text-warning"
            aria-label={`${sparkplugWarningCount} warnings`}
            >{sparkplugWarningCount}</span
          >{/if}</button
      >
    {/each}
  </div>
  <span slot="tooltip-content"
    >{showSparkplug
      ? "Switch between list, graph and Sparkplug views"
      : "Switch between list and graph views"}</span
  >
</Tooltip>
