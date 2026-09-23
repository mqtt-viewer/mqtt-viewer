// Minute-grain aggregation for the broker-status window's long time ranges.
//
// The store's live buffers are second-grain and count-capped: the observed
// series holds 900 settled seconds (15 m at 1 Hz) and each tile holds 900
// samples. That was enough while the longest range was 15 m. Ranges now go up
// to a day, and keeping a day of 1 Hz points would be 86,400 points per series.
//
// So every second-grain sample is also folded into a fixed 1,440-slot ring of
// one-minute averages: exactly a day, whatever the selected range, and the
// memory cost is the same at 1 m as it is at 24 h. The view stitches the closed
// minutes to the still-live second-grain tail (see `stitch`), so the right edge
// of a long chart stays as live as a short one.
import type { SparklineSample } from "./broker-status-store";

export const MINUTE_MS = 60_000;

/** Closed minutes retained per series: 1,440 = one day. */
export const MINUTE_SERIES_CAP = 1440;

/** Start of the wall minute `t` falls in. */
export const minuteStart = (t: number): number =>
  Math.floor(t / MINUTE_MS) * MINUTE_MS;

export interface MinuteSeries {
  /**
   * Folds one second-grain sample into its wall minute. Samples older than the
   * open minute are ignored: a backfill that lands after live data has started
   * would otherwise reopen a closed minute out of order.
   */
  push(t: number, v: number): void;
  /** Closed minutes, oldest first. Each `t` is the minute's start. */
  points(): SparklineSample[];
  /**
   * Start of the still-open minute, or 0 when nothing has been pushed. Points
   * at or after this are not represented in `points()`, so this is where a
   * second-grain tail has to take over.
   */
  openMs(): number;
  reset(): void;
}

/**
 * Ring of one-minute averages. The open minute accumulates a sum and a count
 * (no per-sample allocation) and is only emitted once a later minute arrives,
 * so a closed point always covers a whole minute.
 */
export const createMinuteSeries = (
  cap: number = MINUTE_SERIES_CAP
): MinuteSeries => {
  let closed: SparklineSample[] = [];
  let openMinute = 0;
  let sum = 0;
  let count = 0;

  const closeOpen = () => {
    if (count === 0) return;
    closed.push({ t: openMinute, v: sum / count });
    if (closed.length > cap) closed.splice(0, closed.length - cap);
    sum = 0;
    count = 0;
  };

  return {
    push(t: number, v: number) {
      const minute = minuteStart(t);
      if (count > 0 && minute < openMinute) return; // out of order, drop
      if (count > 0 && minute > openMinute) closeOpen();
      openMinute = minute;
      sum += v;
      count += 1;
    },
    points: () => closed,
    openMs: () => (count > 0 ? openMinute : 0),
    reset() {
      closed = [];
      openMinute = 0;
      sum = 0;
      count = 0;
    },
  };
};

/**
 * Closed minutes followed by the second-grain tail that covers the open minute
 * onwards. `boundary` is the series' `openMs()`; 0 (nothing aggregated yet)
 * returns the raw samples untouched. Points are shared by reference, so this is
 * cheap enough to rebuild on the 1 Hz tick.
 */
export const stitch = (
  minutes: SparklineSample[],
  raw: SparklineSample[],
  boundary: number
): SparklineSample[] => {
  if (boundary <= 0) return raw;
  const out: SparklineSample[] = minutes.slice();
  for (const p of raw) {
    if (p.t >= boundary) out.push(p);
  }
  return out;
};
