<script lang="ts">
  export let points: { t: number; v: number }[] = [];
  export let height = 28;

  // Fixed viewBox width; the svg stretches to its container via
  // preserveAspectRatio="none" + non-scaling stroke.
  const width = 100;
  const pad = 2;

  const toPolylinePoints = (
    pts: { t: number; v: number }[],
    h: number
  ): string => {
    if (pts.length < 2) return "";
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of pts) {
      if (p.t < tMin) tMin = p.t;
      if (p.t > tMax) tMax = p.t;
      if (p.v < vMin) vMin = p.v;
      if (p.v > vMax) vMax = p.v;
    }
    const tRange = tMax - tMin;
    const vRange = vMax - vMin;
    return pts
      .map((p) => {
        // Degenerate t range (all samples at the same time): stack at center.
        const x =
          tRange === 0
            ? width / 2
            : pad + ((p.t - tMin) / tRange) * (width - pad * 2);
        // Flat series (zero value range): render a midline.
        const y =
          vRange === 0
            ? h / 2
            : pad + (1 - (p.v - vMin) / vRange) * (h - pad * 2);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  $: polylinePoints = toPolylinePoints(points, height);
</script>

{#if polylinePoints}
  <svg
    viewBox={`0 0 ${width} ${height}`}
    preserveAspectRatio="none"
    class="w-full overflow-visible"
    style={`height: ${height}px`}
    aria-hidden="true"
    focusable="false"
  >
    <polyline
      points={polylinePoints}
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
{/if}
