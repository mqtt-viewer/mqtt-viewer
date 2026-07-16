<script lang="ts">
  import Sparkline from "../Sparkline/Sparkline.svelte";

  export let label: string;
  export let value: string;
  export let unit: string | undefined = undefined;
  export let points: { t: number; v: number }[] | undefined = undefined;
  export let noData = false;
  // How to render `value`. Numbers are SI-abbreviated by the caller and stay
  // short, so they render big and tabular on one line. Text values (e.g.
  // "mosquitto version 2.0.18") would truncate to "mosquitto versio…" at
  // text-xl, so they drop to a smaller size and wrap to two lines. Fed from the
  // tile's valueKind (empty tiles use number styling behind the noData state).
  export let kind: "number" | "text" = "number";

  $: isText = kind === "text";
</script>

<div
  class="flex h-full min-w-0 flex-col gap-1 rounded border border-outline bg-elevation-1 p-3"
>
  <span class="truncate text-sm text-secondary-text">{label}</span>
  {#if noData}
    <span class="text-base text-secondary-text opacity-60">no data yet</span>
  {:else}
    <div class="flex min-w-0 items-baseline gap-1">
      <span
        class={isText
          ? "line-clamp-2 text-base font-medium leading-snug text-emphasis"
          : "truncate text-xl font-medium tabular-nums text-emphasis"}
        >{value}</span
      >
      {#if unit}
        <span class="shrink-0 text-sm text-secondary-text">{unit}</span>
      {/if}
    </div>
    {#if points && points.length >= 2}
      <div class="mt-1 text-primary opacity-70">
        <Sparkline {points} />
      </div>
    {/if}
  {/if}
</div>
