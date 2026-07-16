// Recency "cooldown" color ramp + EWMA rate + size mapping for the Topic Graph.
// Pure, framework-agnostic. See docs/topic-graph-view-spec.md §5.

export type RGB = { r: number; g: number; b: number };

// Warm -> cold ramp. Each message snaps a topic back to t=0 (red); it cools
// toward the endpoint as the topic idles. Endpoint is theme-aware and supplied
// by the caller (white in dark mode, dim blue in light mode).
const STOPS: Array<[number, RGB]> = [
  [0.0, { r: 229, g: 72, b: 77 }], // red — just now
  [0.18, { r: 232, g: 131, b: 58 }], // orange
  [0.36, { r: 217, g: 162, b: 39 }], // amber
  [0.56, { r: 61, g: 169, b: 138 }], // teal
  [0.78, { r: 61, g: 111, b: 165 }], // blue — cold
];

// Colour-vision-safe alternate ramp (blue↔orange; avoids red/green confusion).
const CVD_STOPS: Array<[number, RGB]> = [
  [0.0, { r: 242, g: 142, b: 44 }], // orange — just now
  [0.3, { r: 226, g: 197, b: 79 }], // yellow
  [0.62, { r: 120, g: 170, b: 200 }], // light blue
  [0.85, { r: 61, g: 111, b: 165 }], // blue
];

export const COLD_ENDPOINT_DARK: RGB = { r: 236, g: 234, b: 231 }; // near-white
export const COLD_ENDPOINT_LIGHT: RGB = { r: 111, g: 143, b: 176 }; // dim blue

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function lerpRGB(a: RGB, b: RGB, f: number): RGB {
  return { r: lerp(a.r, b.r, f), g: lerp(a.g, b.g, f), b: lerp(a.b, b.b, f) };
}

// Age -> ramp position. Linear so a topic stays warm while it's actively
// publishing and only cools toward the cold endpoint as it genuinely idles:
// a 2 msg/s topic (gaps < 0.5s) reads red; one stale ~half the cooldown reads
// teal; one stale a full cooldown reads cold. (A log curve cooled far too fast
// — 1s stale already mapped past teal — so everything looked permanently cold.)
function ageToT(ageMs: number, cooldownMs: number): number {
  if (ageMs <= 0 || cooldownMs <= 0) return 0;
  return Math.max(0, Math.min(1, ageMs / cooldownMs));
}

export function colorForAge(
  ageMs: number,
  cooldownMs: number,
  endpoint: RGB,
  cvdSafe = false
): RGB {
  const t = ageToT(ageMs, cooldownMs);
  const stops: Array<[number, RGB]> = [...(cvdSafe ? CVD_STOPS : STOPS), [1.0, endpoint]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (t >= p0 && t <= p1) {
      const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      return lerpRGB(c0, c1, f);
    }
  }
  return endpoint;
}

// The ramp as CSS gradient stops (hot -> cold), for HTML legend overlays.
export function rampCssGradient(endpoint: RGB, cvdSafe = false): string {
  const stops: Array<[number, RGB]> = [...(cvdSafe ? CVD_STOPS : STOPS), [1.0, endpoint]];
  const parts = stops.map(
    ([p, c]) =>
      `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)}) ${Math.round(p * 100)}%`
  );
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

// Pack an RGB (0-255 components) into a 0xRRGGBB int for Pixi tint.
export function packRGB(c: RGB): number {
  const r = Math.round(c.r) & 0xff;
  const g = Math.round(c.g) & 0xff;
  const b = Math.round(c.b) & 0xff;
  return (r << 16) | (g << 8) | b;
}

export function tintForAge(
  ageMs: number,
  cooldownMs: number,
  endpoint: RGB,
  cvdSafe = false
): number {
  return packRGB(colorForAge(ageMs, cooldownMs, endpoint, cvdSafe));
}

// ---- EWMA decaying-score rate estimator ----
// score ~= exponentially-weighted recent event count. decayScore() ages it to
// `now`; bump it by 1 on each message. rate magnitude is read off the score.

export type DecayScore = { score: number; lastMs: number };

export function decayScore(s: DecayScore, nowMs: number, tauMs: number): number {
  if (s.lastMs === 0) {
    s.lastMs = nowMs;
    return s.score;
  }
  const dt = nowMs - s.lastMs;
  if (dt > 0) {
    s.score *= Math.exp(-dt / tauMs);
    s.lastMs = nowMs;
  }
  return s.score;
}

export function bumpScore(s: DecayScore, nowMs: number, tauMs: number): void {
  decayScore(s, nowMs, tauMs);
  s.score += 1;
}

// Convert a decayed score to an approximate message rate in msg/s. At steady
// state the accumulator converges to rate x tau, so score / tau recovers the
// real unit — comparable across smoothing (tau) settings, unlike the raw score.
export function rateFromScore(score: number, tauMs: number): number {
  if (tauMs <= 0) return 0;
  return score / (tauMs / 1000);
}

// Human-friendly msg/s label for tooltips/legends.
export function formatRate(msgPerSec: number): string {
  if (msgPerSec >= 10) return `${Math.round(msgPerSec)} msg/s`;
  if (msgPerSec >= 1) return `${msgPerSec.toFixed(1)} msg/s`;
  if (msgPerSec >= 0.05) return `${msgPerSec.toFixed(2)} msg/s`;
  if (msgPerSec > 0) return "<0.05 msg/s";
  return "idle";
}

// Map a decayed score to a node radius. area ∝ score (sqrt of score for radius).
export function radiusForScore(score: number, rMin: number, rMax: number, k: number): number {
  const r = rMin + k * Math.sqrt(Math.max(0, score));
  return Math.max(rMin, Math.min(rMax, r));
}
