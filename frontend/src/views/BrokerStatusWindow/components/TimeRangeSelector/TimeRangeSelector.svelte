<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import Tooltip from "@/components/Tooltip/Tooltip.svelte";

  // Selected window in minutes; one of `options`.
  export let value = 5;
  export let options: number[] = [1, 5, 15];
  // Optional note explaining sparse broker series at short ranges; shown as a
  // tooltip on the whole group when set (nothing is ever disabled).
  export let sparseNote: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ change: number }>();

  const select = (minutes: number) => {
    if (minutes === value) return;
    value = minutes;
    dispatch("change", minutes);
  };
</script>

<Tooltip text={sparseNote ?? ""} placement="bottom">
  <div
    class="inline-flex items-center gap-0.5 rounded border border-outline bg-elevation-1 p-0.5"
    role="group"
    aria-label="Time range"
  >
    {#each options as minutes (minutes)}
      <button
        type="button"
        aria-pressed={minutes === value}
        class={`rounded px-2 py-0.5 text-sm tabular-nums transition-colors ${
          minutes === value
            ? "bg-selected text-emphasis"
            : "text-secondary-text hover:text-emphasis"
        }`}
        on:click={() => select(minutes)}
      >
        {minutes}m
      </button>
    {/each}
  </div>
</Tooltip>
