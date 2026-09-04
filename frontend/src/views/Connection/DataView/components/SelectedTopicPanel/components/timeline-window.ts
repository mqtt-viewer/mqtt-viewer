// Time-range and selection maths for the message timeline. vis-timeline hard
// clamps panning to its [min, max] options, so those bounds have to cover every
// message in the loaded history: recorded history from an earlier session, and
// the older windows the "Older" button loads, both sit before this session's
// first connect. Keeping the maths here (rather than inline in the component)
// makes it unit testable without a DOM or a vis instance.

// How far before the anchor the timeline starts, and how far past now it ends.
export const WINDOW_LEAD_MS = 60_000;
export const WINDOW_TRAIL_MS = 10 * 60_000;

// A start/end pair, used both for the visible window and for the pan bounds.
export interface TimelineRange {
  start: Date;
  end: Date;
}

// Everything the bounds depend on. The message bounds are null when the loaded
// history is empty.
export interface TimelineBoundsInput {
  firstConnectedAtMs: number;
  oldestMessageMs: number | null;
  newestMessageMs: number | null;
  nowMs: number;
}

// Which way an arrow key moves the selection.
export type NavigationAction = "next" | "previous";

// The range the timeline opens on: this session's span, from just before the
// first connect to a little past now. A connection that never connected has no
// first-connect time (the view passes 0), so it anchors on now rather than 1970.
export const computeInitialWindow = (
  firstConnectedAtMs: number,
  nowMs: number
): TimelineRange => {
  const anchor = firstConnectedAtMs > 0 ? firstConnectedAtMs : nowMs;
  return {
    start: new Date(anchor - WINDOW_LEAD_MS),
    end: new Date(nowMs + WINDOW_TRAIL_MS),
  };
};

// The hard pan limits. They start from the initial window and are widened to
// take in the loaded history, so a message recorded before this session began
// stays reachable instead of sitting outside the clamp forever.
export const computeTimelineBounds = (
  input: TimelineBoundsInput
): TimelineRange => {
  const initialWindow = computeInitialWindow(
    input.firstConnectedAtMs,
    input.nowMs
  );
  const startMs =
    input.oldestMessageMs === null
      ? initialWindow.start.getTime()
      : Math.min(
          initialWindow.start.getTime(),
          input.oldestMessageMs - WINDOW_LEAD_MS
        );
  const endMs =
    input.newestMessageMs === null
      ? initialWindow.end.getTime()
      : Math.max(input.nowMs, input.newestMessageMs) + WINDOW_TRAIL_MS;
  return { start: new Date(startMs), end: new Date(endMs) };
};

// Where an arrow key moves the selection, wrapping at both ends. An unknown or
// stale index (the dataset was rebuilt under it) recovers to the newest message
// rather than jumping somewhere arbitrary.
export const nextSelectionIndex = (
  currentIndex: number | null,
  length: number,
  action: NavigationAction
): number | null => {
  if (length <= 0) return null;
  if (currentIndex === null || currentIndex < 0 || currentIndex >= length) {
    return length - 1;
  }
  const raw = action === "next" ? currentIndex + 1 : currentIndex - 1;
  if (raw >= length) return 0;
  if (raw < 0) return length - 1;
  return raw;
};
