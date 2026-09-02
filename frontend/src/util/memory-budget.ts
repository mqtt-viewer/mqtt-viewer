// Shared constants and helpers for the memory-budget setting, used by the
// settings dialog and the first-run history retention prompt.

export const MB = 1024 * 1024;
export const GB = 1024 * 1024 * 1024;
export const MIN_MEMORY_MB = 64;

// Measured ~320 MB baseline on macOS (Go process + webview helpers) with no
// history; rounded to a cross-platform figure.
export const BASE_APP_BYTES = 300 * MB;

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

// Rough total app memory: baseline plus the per-connection history budget for
// each active connection (at least one, so an idle app still shows a figure).
export const estimateTotalBytes = (
  budgetMb: number,
  activeConnections: number
): number => BASE_APP_BYTES + budgetMb * MB * Math.max(1, activeConnections);
