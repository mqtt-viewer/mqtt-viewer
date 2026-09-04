// Shared constants and helpers for the memory-budget setting, used by the
// settings dialog and the first-run history retention prompt.

export const MB = 1024 * 1024;
export const GB = 1024 * 1024 * 1024;
export const MIN_MEMORY_MB = 64;

// Connection counts the estimate is shown for.
export const EXAMPLE_CONNECTION_COUNTS = [1, 2, 3] as const;

// The shape of the backend's soft memory limit, fetched via
// GetMemoryLimitModel. Structurally compatible with the generated binding
// class, so nothing here has to import it.
export interface MemoryLimitModel {
  baseBytes: number;
  budgetFactorNumerator: number;
  budgetFactorDenominator: number;
}

// Human-readable byte formatting (e.g. "240 MB", "1.2 GB").
export const formatBytes = (bytes: number | undefined): string => {
  if (bytes === undefined) return "…";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
};

// The headroom multiplier each connected connection gets over its budget, for
// use in copy (1.5 for the real model). Rounded to two decimals: this goes
// straight into a sentence, so a ratio like 7/3 must not print 17 digits.
export const budgetFactor = (model: MemoryLimitModel): number =>
  Math.round(
    (model.budgetFactorNumerator / model.budgetFactorDenominator) * 100
  ) / 100;

// The ceiling the runtime gives itself for this budget and connection count.
// This mirrors MemoryLimitModel.Limit in backend/app/memlimit.go, including its
// integer division, and must stay identical to it. Undefined until the model
// has been fetched, so callers can show a placeholder.
export const estimateTotalBytes = (
  model: MemoryLimitModel | undefined,
  budgetMb: number,
  connections: number
): number | undefined => {
  if (model === undefined) return undefined;
  return (
    model.baseBytes +
    connections *
      Math.floor(
        (budgetMb * MB * model.budgetFactorNumerator) /
          model.budgetFactorDenominator
      )
  );
};
