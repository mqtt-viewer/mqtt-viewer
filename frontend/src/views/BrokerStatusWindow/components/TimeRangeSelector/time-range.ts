// Pure helpers for the broker-status time-range control. Kept out of
// TimeRangeSelector.svelte (like hero-chart-option.ts) so the parse/clamp/
// label rules are unit-testable without mounting the segmented control.
//
// The chart's custom-window field solves the same problem with a different
// cap, so the unit vocabulary is shared from there rather than duplicated.
import {
  parseCustomValue,
  reverseMap,
  unitFactors,
  type Unit,
} from "@/views/Connection/DataView/components/SelectedTopicPanel/components/Chart/chart-custom-window";

export type { Unit };

// Preset windows offered as segments, in minutes.
export const PRESET_MINUTES = [1, 5, 15, 60];

export const MIN_RANGE_SECONDS = 1;

// One day, which is the longest span the broker-status store retains: its
// buffers roll off at 24 hours, so a longer window would only ever draw the
// same data with more empty axis to the left.
export const MAX_RANGE_SECONDS = 86_400;

// Largest whole value of a unit that still fits inside MAX_RANGE_SECONDS.
// Floors to at least 1 so a unit coarser than the cap (none today) could
// never yield a max of 0 and lock the field.
export const maxRangeValueForUnit = (unit: Unit): number =>
  Math.max(1, Math.floor(MAX_RANGE_SECONDS / unitFactors[unit]));

// Parse the raw text of the custom field. Delegates the empty/non-numeric
// rejection and rounding to the shared parser, then re-clamps to this
// control's one-day cap so the value written back into the field always
// matches the window actually applied.
export const parseRangeValue = (
  raw: string | undefined,
  unit: Unit
): number | null => {
  const parsed = parseCustomValue(raw, unit);
  if (parsed === null) return null;
  return Math.min(parsed, maxRangeValueForUnit(unit));
};

// Resolve a validated {value, unit} pair to the window in minutes. May be
// fractional: 30 seconds is 0.5.
export const rangeMinutes = (value: number, unit: Unit): number =>
  (value * unitFactors[unit]) / 60;

// Reverse-map a persisted window in minutes back to a {value, unit} pair,
// using the largest unit that divides it evenly, so the custom field can be
// seeded from it.
export const reverseMapMinutes = (
  minutes: number
): { value: number; unit: Unit } => reverseMap(Math.round(minutes * 60));

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

// Label for a window in minutes: "45s", "5m", "60m", "2h", "1d".
// Anything under a minute, or not a whole number of minutes, reads in
// seconds. Whole minutes up to and including 60 stay in minutes, so the 60m
// preset matches the 1m / 5m / 15m style beside it. Above that, whole days
// read in days, whole hours in hours, and the leftovers (90 minutes, say)
// stay in minutes.
export const formatRangeLabel = (minutes: number): string => {
  if (minutes < 1 || !Number.isInteger(minutes)) {
    return `${Math.round(minutes * 60)}s`;
  }
  if (minutes <= MINUTES_PER_HOUR) return `${minutes}m`;
  if (minutes % MINUTES_PER_DAY === 0) return `${minutes / MINUTES_PER_DAY}d`;
  if (minutes % MINUTES_PER_HOUR === 0) return `${minutes / MINUTES_PER_HOUR}h`;
  return `${minutes}m`;
};
