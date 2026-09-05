// Rough history-retention estimates for the first-boot retention prompt.

// Measured from a real recording database: 1.0 GiB holding ~3.8M rows of
// small-payload flood traffic works out to ~280 bytes per message including
// index overhead. Rounded up to 300 as a conservative figure for small
// payloads.
export const BYTES_PER_MESSAGE_ESTIMATE = 300;

export const estimateRetentionSeconds = (
  budgetBytes: number,
  messagesPerSecond: number
): number => {
  if (
    !Number.isFinite(budgetBytes) ||
    !Number.isFinite(messagesPerSecond) ||
    budgetBytes <= 0 ||
    messagesPerSecond <= 0
  ) {
    return 0;
  }
  return budgetBytes / BYTES_PER_MESSAGE_ESTIMATE / messagesPerSecond;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const formatRetentionDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "no history";
  }
  if (seconds < MINUTE) {
    return "less than a minute";
  }
  // 55 minutes rather than a full hour: "about 58 minutes" reads worse than
  // "about 1 hour" for near-hour durations.
  if (seconds < 55 * MINUTE) {
    const minutes = Math.round(seconds / MINUTE);
    return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (seconds < 48 * HOUR) {
    const hours = Math.round(seconds / HOUR);
    return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.round(seconds / DAY);
  return `about ${days} ${days === 1 ? "day" : "days"}`;
};
