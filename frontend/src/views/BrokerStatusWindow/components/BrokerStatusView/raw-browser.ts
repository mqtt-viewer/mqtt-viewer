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
