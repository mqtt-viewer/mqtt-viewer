<script lang="ts">
  export let points: { t: number; v: number }[] = [];
  export let height = 28;

  // Fixed viewBox width; the svg stretches to its container via
  // preserveAspectRatio="none" + non-scaling stroke.
  const width = 100;
  const pad = 2;

  // Cap on rendered points. A 15 m sparkline holds up to 900 samples; the SVG
  // is ~100 px wide, so more than ~150 points is invisible detail and wasted
  // DOM. See docs/broker-status-v2-spec.md.
  const MAX_POINTS = 150;

  type Pt = { t: number; v: number };

  // Min-max decimation bucketed BY ARRAY INDEX (never by time): each bucket
  // emits its lowest and highest sample in original order, so peaks and troughs
  // survive. Index bucketing sidesteps the degenerate case where every sample
  // shares one timestamp (a time-bucketed pass would collapse them all). The
  // true last sample is always emitted so the line ends where the data does.
  const decimate = (pts: Pt[]): Pt[] => {
    if (pts.length <= MAX_POINTS) return pts;
    const buckets = Math.floor(MAX_POINTS / 2); // 2 emitted points per bucket
    const bucketSize = pts.length / buckets;
    const out: Pt[] = [];
    for (let b = 0; b < buckets; b++) {
      const start = Math.floor(b * bucketSize);
      const end = Math.min(pts.length, Math.floor((b + 1) * bucketSize));
      if (start >= end) continue;
      let minI = start;
      let maxI = start;
      for (let i = start + 1; i < end; i++) {
        if (pts[i].v < pts[minI].v) minI = i;
        if (pts[i].v > pts[maxI].v) maxI = i;
      }
      const lo = Math.min(minI, maxI);
      const hi = Math.max(minI, maxI);
      out.push(pts[lo]);
      if (hi !== lo) out.push(pts[hi]);
    }
    const last = pts[pts.length - 1];
    if (out.length === 0 || out[out.length - 1] !== last) out.push(last);
    return out;
  };

  const toPolylinePoints = (rawPts: Pt[], h: number): string => {
    if (rawPts.length < 2) return "";
    const pts = decimate(rawPts);
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
