import { describe, expect, it } from "vitest";
import { sampleEvenly } from "./timeline-sampling";

const range = (length: number): number[] =>
  Array.from({ length }, (_, i) => i);

describe("sampleEvenly", () => {
  it("returns the input unchanged when length <= max", () => {
    const items = range(10);
    expect(sampleEvenly(items, 10)).toBe(items);
    expect(sampleEvenly(items, 100)).toBe(items);
  });

  it("returns an empty array for empty input", () => {
    expect(sampleEvenly([], 5)).toEqual([]);
  });

  it("returns an empty array when max <= 0", () => {
    expect(sampleEvenly(range(10), 0)).toEqual([]);
    expect(sampleEvenly(range(10), -3)).toEqual([]);
  });

  it("returns exactly max items when the input is larger", () => {
    expect(sampleEvenly(range(1000), 150)).toHaveLength(150);
    expect(sampleEvenly(range(151), 150)).toHaveLength(150);
    expect(sampleEvenly(range(20000), 1000)).toHaveLength(1000);
  });

  it("always includes the last element", () => {
    expect(sampleEvenly(range(1000), 150).at(-1)).toBe(999);
    expect(sampleEvenly(range(151), 150).at(-1)).toBe(150);
    expect(sampleEvenly(range(7), 3).at(-1)).toBe(6);
  });

  it("selects monotonically increasing items with no duplicates", () => {
    for (const [length, max] of [
      [1000, 150],
      [151, 150],
      [20000, 1000],
      [17, 5],
    ] as const) {
      const sampled = sampleEvenly(range(length), max);
      for (let i = 1; i < sampled.length; i++) {
        expect(sampled[i]).toBeGreaterThan(sampled[i - 1]);
      }
    }
  });

  it("spaces selections evenly across the input", () => {
    const sampled = sampleEvenly(range(1000), 100);
    // Stride is 10, so each pick should land at the end of its bucket.
    expect(sampled[0]).toBe(9);
    expect(sampled[49]).toBe(499);
    expect(sampled.at(-1)).toBe(999);
  });

  it("returns just the last element when max is 1", () => {
    expect(sampleEvenly(range(10), 1)).toEqual([9]);
  });
});
