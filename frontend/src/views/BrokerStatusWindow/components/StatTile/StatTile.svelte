<script lang="ts">
  import Sparkline from "../Sparkline/Sparkline.svelte";

  export let label: string;
  export let value: string;
  export let unit: string | undefined = undefined;
  export let points: { t: number; v: number }[] | undefined = undefined;
  export let noData = false;
  // How to render `value`. Numbers are SI-abbreviated by the caller and stay
  // short, so they render big and tabular on one line. Text values (e.g. a
  // custom tile bound to a string topic) would truncate at the large size, so
  // they drop to a smaller size and wrap to two lines. Fed from the tile's
  // valueKind (empty tiles use number styling behind the noData state).
  export let kind: "number" | "text" = "number";
  // Percentage change across the visible window (last vs first sample), supplied
  // by the caller. A small direction glyph shows only when |delta| >= 2 %, so
  // steady tiles carry no ambient flicker. Anything past 999 % (including
  // Infinity, from a zero baseline) prints as ">999%".
  export let deltaPct: number | undefined = undefined;
  // Exact, unabbreviated value string for the hover panel (falls back to the
  // display `value` when absent).
  export let exact: string | undefined = undefined;
  // One-line description shown at the top of the hover panel (e.g. the observed
  // tiles' "measured by this client" note — this tile owns that hover now).
  export let description: string | undefined = undefined;
  // Window the sparkline and delta span, named in the hover panel. The caller
  // derives it from the samples actually held, not a fixed constant.
  export let windowName = "15m";

  const DELTA_THRESHOLD = 2; // percent
  // Ceiling on the printed percentage. Past this the exact figure carries no
  // information ("up 12,364%" reads as a bug), and a near-zero baseline can
  // make it arbitrarily large or infinite.
  const DELTA_MAX_PCT = 999;

  $: isText = kind === "text";
  // Growth from a zero (or vanishing) baseline: a percentage against it is
  // meaningless, so it shares the ">999%" ceiling rather than printing a bare
  // arrow with no number.
  $: deltaCapped =
    deltaPct !== undefined &&
    (!Number.isFinite(deltaPct) || Math.abs(deltaPct) > DELTA_MAX_PCT);
  $: showDelta =
    !noData &&
    deltaPct !== undefined &&
    (deltaCapped || Math.abs(deltaPct) >= DELTA_THRESHOLD);
  $: deltaUp = (deltaPct ?? 0) >= 0;
  $: deltaText = deltaCapped
    ? `>${DELTA_MAX_PCT}%`
    : `${Math.abs(deltaPct ?? 0).toFixed(0)}%`;

  // Min/max over the visible samples, for the hover panel. One pass, no spread:
  // this recomputes on every store flush, for every tile.
  const extent = (
    pts: { t: number; v: number }[] | undefined
  ): { min: number; max: number } | null => {
    if (!pts || pts.length < 2) return null;
    let min = pts[0].v;
    let max = pts[0].v;
    for (let i = 1; i < pts.length; i++) {
      const v = pts[i].v;
      if (v < min) min = v;
      else if (v > max) max = v;
    }
    return { min, max };
  };

  $: sampleExtent = extent(points);

  // One number format for the whole panel (exact value and min/max): grouped,
  // at most two decimals.
  const fmtPanelNumber = (n: number): string =>
    n.toLocaleString(undefined, { maximumFractionDigits: 2 });
</script>

<!-- `group` + focus-within drive the hover panel: it opens on pointer hover and
     on keyboard focus of the tile, matching the spec's hover + focus-visible. -->
<div
  class="group relative flex h-full min-w-0 flex-col gap-0.5 rounded border border-outline bg-elevation-1 px-3 pb-2 pt-2.5 focus-visible:ring"
  tabindex="0"
  role="group"
  aria-label={label}
>
  <div class="flex min-w-0 items-baseline gap-1">
    <span class="min-w-0 flex-1 truncate text-xs text-secondary-text"
      >{label}</span
    >
    {#if showDelta}
      <span
        class="shrink-0 font-mono text-xs tabular-nums leading-none text-secondary-text"
        aria-label={`${deltaUp ? "up" : "down"} ${
          deltaCapped ? "more than 999" : Math.abs(deltaPct ?? 0).toFixed(0)
        } percent over ${windowName}`}
      >
        {deltaUp ? "▲" : "▼"} {deltaText}
      </span>
    {/if}
  </div>

  {#if noData}
    <span class="text-sm text-secondary-text opacity-60">No data yet</span>
  {:else}
    <div class="flex min-w-0 items-baseline gap-1">
      <span
        class={isText
          ? "line-clamp-2 text-sm font-medium leading-snug text-emphasis"
          : "truncate font-mono text-lg font-semibold tabular-nums leading-tight text-emphasis"}
        >{value}</span
      >
      {#if unit}
        <span class="shrink-0 text-xs text-secondary-text">{unit}</span>
      {/if}
    </div>
    {#if points && points.length >= 2}
      <div class="mt-1.5 text-primary opacity-70">
        <Sparkline {points} height={26} />
      </div>
    {/if}
  {/if}

  <!-- Hover/focus panel: exact value, min/max, and the window it spans. Owned
       by the tile so each tile has one hover surface (no outer Tooltip). It
       opens BELOW the tile, anchored to its left edge: above-placement clipped
       against the sticky health strip and the scroll container's top, and a
       centred panel overflowed the window edge on the outer columns. Hidden on
       no-data tiles (nothing to detail). -->
  {#if !noData}
  <div
    class="pointer-events-none absolute left-0 right-0 top-full z-[10003] mt-1 hidden
      flex-col gap-0.5 rounded border border-outline bg-elevation-2 px-3 py-2 text-xs
      shadow group-hover:flex group-focus-within:flex"
    role="tooltip"
  >
    {#if description}
      <span class="text-secondary-text">{description}</span>
    {/if}
    <span class="font-mono tabular-nums text-emphasis">{exact ?? value}</span>
    {#if sampleExtent}
      <span class="font-mono tabular-nums text-secondary-text">
        min {fmtPanelNumber(sampleExtent.min)}, max {fmtPanelNumber(sampleExtent.max)}
      </span>
    {/if}
    <span class="text-secondary-text">over {windowName}</span>
  </div>
  {/if}
</div>
