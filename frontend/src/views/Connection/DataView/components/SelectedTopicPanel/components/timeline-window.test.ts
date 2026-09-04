import { describe, expect, it } from "vitest";
import {
  WINDOW_LEAD_MS,
  WINDOW_TRAIL_MS,
  computeInitialWindow,
  computeTimelineBounds,
  nextSelectionIndex,
} from "./timeline-window";

const NOW = Date.parse("2026-09-03T09:40:00.000Z");
const CONNECTED_AT = Date.parse("2026-09-03T09:35:00.000Z");

describe("computeInitialWindow", () => {
  it("starts a lead before the connect time and ends a trail after now", () => {
    const window = computeInitialWindow(CONNECTED_AT, NOW);
    expect(window.start.getTime()).toBe(CONNECTED_AT - WINDOW_LEAD_MS);
    expect(window.end.getTime()).toBe(NOW + WINDOW_TRAIL_MS);
  });

  it("anchors on now when the connection never connected", () => {
    const window = computeInitialWindow(0, NOW);
    expect(window.start.getTime()).toBe(NOW - WINDOW_LEAD_MS);
    expect(window.start.getUTCFullYear()).toBe(2026);
  });
});

describe("computeTimelineBounds", () => {
  it("matches the initial window when no messages are loaded", () => {
    const initialWindow = computeInitialWindow(CONNECTED_AT, NOW);
    const bounds = computeTimelineBounds({
      firstConnectedAtMs: CONNECTED_AT,
      oldestMessageMs: null,
      newestMessageMs: null,
      nowMs: NOW,
    });
    expect(bounds.start.getTime()).toBe(initialWindow.start.getTime());
    expect(bounds.end.getTime()).toBe(initialWindow.end.getTime());
  });

  it("stretches back to cover a message recorded before this session", () => {
    const oldest = Date.parse("2026-09-01T12:00:00.000Z");
    const bounds = computeTimelineBounds({
      firstConnectedAtMs: CONNECTED_AT,
      oldestMessageMs: oldest,
      newestMessageMs: NOW,
      nowMs: NOW,
    });
    expect(bounds.start.getTime()).toBe(oldest - WINDOW_LEAD_MS);
  });

  it("keeps the initial start when every message is newer than the connect time", () => {
    const initialWindow = computeInitialWindow(CONNECTED_AT, NOW);
    const bounds = computeTimelineBounds({
      firstConnectedAtMs: CONNECTED_AT,
      oldestMessageMs: CONNECTED_AT + 30_000,
      newestMessageMs: NOW,
      nowMs: NOW,
    });
    expect(bounds.start.getTime()).toBe(initialWindow.start.getTime());
  });

  it("stretches forward for a message stamped after now", () => {
    const newest = NOW + 60 * 60_000;
    const bounds = computeTimelineBounds({
      firstConnectedAtMs: CONNECTED_AT,
      oldestMessageMs: CONNECTED_AT,
      newestMessageMs: newest,
      nowMs: NOW,
    });
    expect(bounds.end.getTime()).toBe(newest + WINDOW_TRAIL_MS);
  });

  it("ends a trail past now when every message is older than now", () => {
    const bounds = computeTimelineBounds({
      firstConnectedAtMs: CONNECTED_AT,
      oldestMessageMs: CONNECTED_AT,
      newestMessageMs: NOW - 120_000,
      nowMs: NOW,
    });
    expect(bounds.end.getTime()).toBe(NOW + WINDOW_TRAIL_MS);
  });

  it("handles a null oldest with a set newest, and the reverse", () => {
    const initialWindow = computeInitialWindow(CONNECTED_AT, NOW);
    const newestOnly = computeTimelineBounds({
      firstConnectedAtMs: CONNECTED_AT,
      oldestMessageMs: null,
      newestMessageMs: NOW + 60_000,
      nowMs: NOW,
    });
    expect(newestOnly.start.getTime()).toBe(initialWindow.start.getTime());
    expect(newestOnly.end.getTime()).toBe(NOW + 60_000 + WINDOW_TRAIL_MS);

    const oldestOnly = computeTimelineBounds({
      firstConnectedAtMs: CONNECTED_AT,
      oldestMessageMs: CONNECTED_AT - 600_000,
      newestMessageMs: null,
      nowMs: NOW,
    });
    expect(oldestOnly.start.getTime()).toBe(
      CONNECTED_AT - 600_000 - WINDOW_LEAD_MS
    );
    expect(oldestOnly.end.getTime()).toBe(initialWindow.end.getTime());
  });

  it("never produces an invalid date", () => {
    const bounds = computeTimelineBounds({
      firstConnectedAtMs: 0,
      oldestMessageMs: null,
      newestMessageMs: null,
      nowMs: NOW,
    });
    expect(Number.isNaN(bounds.start.getTime())).toBe(false);
    expect(Number.isNaN(bounds.end.getTime())).toBe(false);
  });
});

describe("nextSelectionIndex", () => {
  it("steps forward", () => {
    expect(nextSelectionIndex(2, 5, "next")).toBe(3);
  });

  it("steps backward", () => {
    expect(nextSelectionIndex(2, 5, "previous")).toBe(1);
  });

  it("wraps forward from the last index", () => {
    expect(nextSelectionIndex(4, 5, "next")).toBe(0);
  });

  it("wraps backward from the first index", () => {
    expect(nextSelectionIndex(0, 5, "previous")).toBe(4);
  });

  it("returns null for an empty history", () => {
    expect(nextSelectionIndex(0, 0, "next")).toBeNull();
    expect(nextSelectionIndex(null, 0, "previous")).toBeNull();
  });

  it("recovers to the newest message from a stale index", () => {
    expect(nextSelectionIndex(9, 5, "next")).toBe(4);
  });

  it("recovers to the newest message when nothing is selected", () => {
    expect(nextSelectionIndex(null, 5, "next")).toBe(4);
    expect(nextSelectionIndex(null, 5, "previous")).toBe(4);
  });

  it("does not wrap to 0 when stepping back from a stale index", () => {
    expect(nextSelectionIndex(9, 5, "previous")).toBe(4);
    expect(nextSelectionIndex(-3, 5, "previous")).toBe(4);
  });
});
