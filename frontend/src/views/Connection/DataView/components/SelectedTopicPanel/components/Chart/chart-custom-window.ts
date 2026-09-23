// Pure helpers for the chart-options custom time-window field. Kept out of
// ChartOptions.svelte (like chart-option.ts) so the parse/clamp/reverse-map
// rules are unit-testable without mounting the menu.

export type Unit = "seconds" | "minutes" | "hours" | "days";

export const unitFactors: Record<Unit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
};

// Upper bound for any window: 366 days in seconds. Anything longer is
// indistinguishable from "All history" for retained data and would only
// invite overflow-ish inputs.
export const MAX_WINDOW_SECONDS = 31_622_400;

// Largest whole value the custom field accepts for a unit without the
// resulting window exceeding MAX_WINDOW_SECONDS.
export const maxValueForUnit = (unit: Unit): number =>
  Math.floor(MAX_WINDOW_SECONDS / unitFactors[unit]);

// Reverse-map a non-preset seconds value to a {value, unit} pair, using the
// largest unit that divides it evenly, so the custom field can be seeded
// from a persisted value.
export const reverseMap = (s: number): { value: number; unit: Unit } => {
  if (s % 86400 === 0) return { value: s / 86400, unit: "days" };
  if (s % 3600 === 0) return { value: s / 3600, unit: "hours" };
  if (s % 60 === 0) return { value: s / 60, unit: "minutes" };
  return { value: s, unit: "seconds" };
};

// Parse the raw text of the custom field. Returns null when the text is
// unusable (empty or non-numeric); otherwise rounds decimals to the nearest
// integer and clamps to [1, maxValueForUnit(unit)] so the value written back
// into the field always matches the window that gets applied.
export const parseCustomValue = (
  raw: string | undefined,
  unit: Unit
): number | null => {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, 1), maxValueForUnit(unit));
};

// Resolve a validated {value, unit} pair to the canonical seconds.
export const customWindowSeconds = (value: number, unit: Unit): number =>
  value * unitFactors[unit];
