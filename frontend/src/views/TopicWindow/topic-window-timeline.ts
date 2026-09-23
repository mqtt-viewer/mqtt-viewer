// MessageTimeline bounds its lower edge at firstConnectedAtMs minus a minute,
// so a 0 there puts the timeline at 1970. The pop-out never runs the main
// window's connect handler, so fall back to the oldest message it holds, and
// to "a minute ago" when it holds none.
export const timelineStartMs = (
  firstConnectedAtMs: number | null | undefined,
  oldestMessageMs: number | null | undefined,
  nowMs: number
): number => {
  if (isUsable(firstConnectedAtMs)) return firstConnectedAtMs;
  if (isUsable(oldestMessageMs)) return oldestMessageMs;
  return nowMs - 60_000;
};

const isUsable = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
