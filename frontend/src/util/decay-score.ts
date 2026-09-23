// EWMA decaying-score rate estimator. Pure, framework-agnostic.
//
// A `score` is an exponentially-weighted recent event count: each event bumps
// it, and it decays continuously toward zero with time-constant `tauMs` (a
// leaky integrator). This is the shared engine behind both the Topic Graph's
// "Busiest" ordering and the topic List's rate sort. The graph re-exports these
// from its `cooldown.ts` so its existing imports keep working unchanged.

export type DecayScore = { score: number; lastMs: number };

// Time-constant for the topic List's "Busiest" rate estimator, fixed at the
// Topic Graph's default tau so both views rank busyness equivalently. Lives in
// this pure module (not the store) so the List sort can share it without
// dragging the Wails-coupled store into node-env unit tests.
export const LIST_RATE_TAU_MS = 14000;

// Age `s` to `nowMs` in place and return the decayed score. Mutates `s`
// (updates score + lastMs); callers that must not perturb the live state use
// `peekScore` instead.
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

// Read-only variant of `decayScore`: returns the score decayed to `nowMs`
// WITHOUT writing it back. Used by sort passes that compute many nodes' scores
// against one shared `now` and must not corrupt live store objects.
export function peekScore(s: DecayScore, nowMs: number, tauMs: number): number {
  if (s.lastMs === 0) return s.score;
  const dt = nowMs - s.lastMs;
  if (dt <= 0) return s.score;
  return s.score * Math.exp(-dt / tauMs);
}

// Decay `s` to `nowMs`, then add `by` (default 1). `by` lets a batched caller
// that collapsed N messages for one topic into a single insert still credit all
// N events: decay to now, then `score += N`.
export function bumpScore(
  s: DecayScore,
  nowMs: number,
  tauMs: number,
  by = 1
): void {
  decayScore(s, nowMs, tauMs);
  s.score += by;
}

// Convert a decayed score to an approximate message rate in msg/s. At steady
// state the accumulator converges to rate x tau, so score / tau recovers the
// real unit — comparable across smoothing (tau) settings, unlike the raw score.
export function rateFromScore(score: number, tauMs: number): number {
  if (tauMs <= 0) return 0;
  return score / (tauMs / 1000);
}
