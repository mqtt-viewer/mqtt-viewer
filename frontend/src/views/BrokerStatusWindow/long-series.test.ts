import { describe, it, expect } from "vitest";
import {
  MINUTE_MS,
  createMinuteSeries,
  minuteStart,
  stitch,
} from "./long-series";

const M = MINUTE_MS;

describe("minuteStart", () => {
  it("floors to the wall minute", () => {
    expect(minuteStart(0)).toBe(0);
    expect(minuteStart(59_999)).toBe(0);
    expect(minuteStart(60_000)).toBe(60_000);
    expect(minuteStart(90_000)).toBe(60_000);
  });
});

describe("createMinuteSeries", () => {
  it("emits nothing until a minute closes", () => {
    const s = createMinuteSeries();
    s.push(1_000, 4);
    s.push(2_000, 6);
    expect(s.points()).toEqual([]);
    expect(s.openMs()).toBe(0);
  });

  it("averages a closed minute and stamps it at the minute start", () => {
    const s = createMinuteSeries();
    s.push(1_000, 4);
    s.push(2_000, 6);
    s.push(M + 1_000, 100); // opens the next minute, closing the first
    expect(s.points()).toEqual([{ t: 0, v: 5 }]);
    expect(s.openMs()).toBe(M);
  });

  it("keeps only the newest `cap` closed minutes", () => {
    const s = createMinuteSeries(3);
    for (let i = 0; i < 6; i++) s.push(i * M, i);
    // Minutes 0..4 closed; 5 still open.
    expect(s.points().map((p) => p.t)).toEqual([2 * M, 3 * M, 4 * M]);
    expect(s.openMs()).toBe(5 * M);
  });

  it("drops out-of-order samples rather than reopening a closed minute", () => {
    const s = createMinuteSeries();
    s.push(0, 1);
    s.push(2 * M, 10);
    s.push(M, 999); // late arrival for an already-passed minute
    expect(s.points()).toEqual([{ t: 0, v: 1 }]);
    expect(s.openMs()).toBe(2 * M);
  });

  it("resets to empty", () => {
    const s = createMinuteSeries();
    s.push(0, 1);
    s.push(2 * M, 2);
    s.reset();
    expect(s.points()).toEqual([]);
    expect(s.openMs()).toBe(0);
  });
});

describe("stitch", () => {
  it("returns the raw samples when nothing has been aggregated", () => {
    const raw = [{ t: 1, v: 1 }];
    expect(stitch([], raw, 0)).toBe(raw);
  });

  it("appends only the tail at or after the open minute", () => {
    const minutes = [{ t: 0, v: 1 }];
    const raw = [
      { t: M - 1_000, v: 9 },
      { t: M, v: 2 },
      { t: M + 1_000, v: 3 },
    ];
    expect(stitch(minutes, raw, M)).toEqual([
      { t: 0, v: 1 },
      { t: M, v: 2 },
      { t: M + 1_000, v: 3 },
    ]);
  });

  it("does not mutate the closed-minute array", () => {
    const minutes = [{ t: 0, v: 1 }];
    stitch(minutes, [{ t: M, v: 2 }], M);
    expect(minutes).toHaveLength(1);
  });
});
