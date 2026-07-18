// Helpers for the raw $SYS browser inside BrokerStatusView.
//
// `nowTick` is a single shared 1 s-interval readable. Because it uses Svelte's
// start/stop notifier, the interval only runs while the store has at least one
// subscriber — the browser references `$nowTick` solely inside the expanded
// block, so no timer runs (and no per-row age re-renders happen) while the raw
// browser is collapsed. One interval feeds every row; ages are derived, not
// stored per row.

import { readable } from "svelte/store";

/** Shared wall-clock tick; emits Date.now() once per second while subscribed. */
export const nowTick = readable(Date.now(), (set) => {
  const id = setInterval(() => set(Date.now()), 1000);
  return () => clearInterval(id);
});

/**
 * Compact relative age like "3s ago", "5m ago", "2h ago", "4d ago". Clamped at
 * 0 so a slightly-future timestamp (clock skew) reads "0s ago" rather than a
 * negative value.
 */
export const formatAge = (nowMs: number, timeMs: number): string => {
  const s = Math.max(0, Math.floor((nowMs - timeMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

// --- Derived rate column (counter-like $SYS topics) --------------------------
// The raw browser shows a per-second rate for topics that behave like
// monotonic counters. A topic is treated as counter-like once it has produced
// `RATE_MIN_RUN` consecutive non-decreasing numeric observations (the spec's
// monotonicity heuristic); until then, and for gauge-like topics that go up and
// down, no rate is shown. State is kept per topic in a tracker the view owns
// (never in the store's latestByTopic), and reset on a history clear.
//
// Only observations seen while the browser is expanded feed the tracker, so a
// freshly-expanded browser starts each topic's run from scratch — acceptable,
// since the rate column only exists while expanded.

/** Consecutive non-decreasing numeric samples before a topic counts as a counter. */
export const RATE_MIN_RUN = 3;

interface RawRateTopicState {
  /** Previous numeric value, for the /s delta. null once the streak breaks. */
  prevValue: number | null;
  /** Time (ms) of `prevValue`. */
  prevTimeMs: number;
  /** Newest observation time already folded in (idempotency guard). */
  lastTimeMs: number;
  /** Length of the current non-decreasing numeric run. */
  run: number;
  /** Derived /s rate once counter-like, else null. */
  rate: number | null;
}

export interface RawRateTracker {
  /**
   * Folds a topic's newest decoded value in and returns its derived /s rate, or
   * null when the topic is not (yet) counter-like. Idempotent for a repeated
   * `(topic, timeMs)` so it is safe to call from a reactive block.
   */
  update(topic: string, rawValue: string, timeMs: number): number | null;
  /** Drops all per-topic state (call when the connection's history is cleared). */
  reset(): void;
}

/** Parses a bare numeric payload; null for anything non-numeric. */
const numericPayload = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

export const createRawRateTracker = (): RawRateTracker => {
  const byTopic = new Map<string, RawRateTopicState>();

  const update = (topic: string, rawValue: string, timeMs: number): number | null => {
    let st = byTopic.get(topic);
    if (st === undefined) {
      st = { prevValue: null, prevTimeMs: -1, lastTimeMs: -1, run: 0, rate: null };
      byTopic.set(topic, st);
    }
    // Already folded this observation: return the cached rate unchanged.
    if (timeMs <= st.lastTimeMs) return st.rate;
    st.lastTimeMs = timeMs;

    const num = numericPayload(rawValue);
    if (num === null) {
      // Non-numeric breaks the counter streak.
      st.run = 0;
      st.prevValue = null;
      st.rate = null;
      return null;
    }

    // A non-decreasing step extends the run; a decrease (counter reset) or the
    // first numeric sample starts a fresh run of length 1.
    if (st.prevValue !== null && num >= st.prevValue) st.run += 1;
    else st.run = 1;

    if (st.run >= RATE_MIN_RUN && st.prevValue !== null) {
      const dt = (timeMs - st.prevTimeMs) / 1000;
      st.rate = dt > 0 ? (num - st.prevValue) / dt : st.rate;
    } else {
      st.rate = null;
    }

    st.prevValue = num;
    st.prevTimeMs = timeMs;
    return st.rate;
  };

  const reset = () => byTopic.clear();

  return { update, reset };
};
