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
  // Percentage change across the visible window (last vs first sample), supplied
  // by the caller. A small direction arrow shows only when |delta| >= 2 %, so
  // steady tiles carry no ambient flicker.
  export let deltaPct: number | undefined = undefined;
  // Exact, unabbreviated value string for the hover panel (falls back to the
  // display `value` when absent).
  export let exact: string | undefined = undefined;
  // One-line description shown at the top of the hover panel (e.g. the observed
  // tiles' "measured by this client" note — this tile owns that hover now).
  export let description: string | undefined = undefined;
  // Window the sparkline and delta span, named in the hover panel.
  export let windowName = "15m";

  const DELTA_THRESHOLD = 2; // percent

  $: isText = kind === "text";
  $: showDelta =
    !noData && deltaPct !== undefined && Math.abs(deltaPct) >= DELTA_THRESHOLD;
  $: deltaUp = (deltaPct ?? 0) >= 0;

  // Min/max over the visible samples, for the hover panel.
  $: hasSamples = !!points && points.length >= 2;
  $: sampleMin = hasSamples ? Math.min(...points!.map((p) => p.v)) : null;
  $: sampleMax = hasSamples ? Math.max(...points!.map((p) => p.v)) : null;

  const fmtPanelNumber = (n: number): string =>
    Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2);
</script>

<!-- `group` + focus-within drive the hover panel: it opens on pointer hover and
     on keyboard focus of the tile, matching the spec's hover + focus-visible. -->
<div
  class="group relative flex h-full min-w-0 flex-col gap-1 rounded border border-outline bg-elevation-1 p-3 focus-visible:ring"
  tabindex="0"
  role="group"
  aria-label={label}
>
  <div class="flex min-w-0 items-center gap-1">
    <span class="min-w-0 flex-1 truncate text-sm text-secondary-text">{label}</span>
    {#if showDelta}
      <span
        class="shrink-0 text-xs tabular-nums text-secondary-text"
        aria-label={`${deltaUp ? "up" : "down"} ${Math.abs(deltaPct ?? 0).toFixed(0)} percent over ${windowName}`}
      >
        {deltaUp ? "↑" : "↓"}{Math.abs(deltaPct ?? 0).toFixed(0)}%
      </span>
    {/if}
  </div>

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

  <!-- Hover/focus panel: exact value, min/max, and the window it spans. Owned
       by the tile so each tile has one hover surface (no outer Tooltip). -->
  <div
    class="pointer-events-none absolute left-1/2 bottom-full z-[10003] mb-1 hidden w-max max-w-[240px]
      -translate-x-1/2 flex-col gap-0.5 rounded border border-outline bg-elevation-2 px-3 py-2 text-xs
      shadow group-hover:flex group-focus-within:flex"
    role="tooltip"
  >
    {#if description}
      <span class="text-secondary-text">{description}</span>
    {/if}
    <span class="font-mono tabular-nums text-emphasis">{exact ?? value}</span>
    {#if sampleMin !== null && sampleMax !== null}
      <span class="font-mono tabular-nums text-secondary-text">
        min {fmtPanelNumber(sampleMin)}, max {fmtPanelNumber(sampleMax)}
      </span>
    {/if}
    <span class="text-secondary-text">over {windowName}</span>
  </div>
</div>
