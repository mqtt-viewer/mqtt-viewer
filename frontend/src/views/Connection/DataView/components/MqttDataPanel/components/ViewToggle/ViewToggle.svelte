<script lang="ts">
  import { twMerge } from "tailwind-merge";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";

  export let view: "list" | "graph";
  export let onChange: (view: "list" | "graph") => void;
</script>

<Tooltip placement="bottom">
  <div
    class="inline-flex h-[30px] shrink-0 overflow-hidden rounded border border-outline text-xs text-secondary-text"
  >
    <button
      class={twMerge(
        "px-2.5 transition-colors hover:text-emphasis",
        view === "list" && "bg-elevation-2 text-white-text"
      )}
      on:click={() => onChange("list")}>List</button
    >
    <button
      class={twMerge(
        "px-2.5 transition-colors hover:text-emphasis",
        view === "graph" && "bg-elevation-2 text-white-text"
      )}
      on:click={() => onChange("graph")}>Graph</button
    >
  </div>
  <span slot="tooltip-content">Switch between list and graph views</span>
</Tooltip>
