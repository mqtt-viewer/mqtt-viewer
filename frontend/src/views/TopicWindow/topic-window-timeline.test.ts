import { describe, it, expect } from "vitest";
import { timelineStartMs } from "./topic-window-timeline";

const NOW = 1_700_000_000_000;

describe("timelineStartMs", () => {
  it("prefers the connect timestamp when it is usable", () => {
    expect(timelineStartMs(NOW - 5000, NOW - 1000, NOW)).toBe(NOW - 5000);
  });

  it("falls back to the oldest held message", () => {
    expect(timelineStartMs(0, NOW - 1000, NOW)).toBe(NOW - 1000);
    expect(timelineStartMs(undefined, NOW - 1000, NOW)).toBe(NOW - 1000);
    expect(timelineStartMs(null, NOW - 1000, NOW)).toBe(NOW - 1000);
  });

  it("falls back to a minute ago when nothing else is usable", () => {
    expect(timelineStartMs(0, 0, NOW)).toBe(NOW - 60_000);
    expect(timelineStartMs(undefined, undefined, NOW)).toBe(NOW - 60_000);
    expect(timelineStartMs(null, null, NOW)).toBe(NOW - 60_000);
  });

  it("rejects negative and non-finite values", () => {
    expect(timelineStartMs(-1, -1, NOW)).toBe(NOW - 60_000);
    expect(timelineStartMs(-1, NOW - 2000, NOW)).toBe(NOW - 2000);
    expect(timelineStartMs(NaN, Infinity, NOW)).toBe(NOW - 60_000);
  });

  it("never hands MessageTimeline a 1970 epoch", () => {
    expect(timelineStartMs(0, 0, NOW)).toBeGreaterThan(NOW - 120_000);
    expect(timelineStartMs(0, undefined, NOW)).not.toBe(0);
  });
});
