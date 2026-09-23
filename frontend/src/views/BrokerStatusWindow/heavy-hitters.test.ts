import { describe, it, expect } from "vitest";
import {
  createHeavyHitters,
  lowerBound,
  type HeavyHitterEntry,
} from "./heavy-hitters";

const ranked = (entries: HeavyHitterEntry[]) =>
  entries
    .map((e) => ({ topic: e.topic, ...lowerBound(e) }))
    .sort((a, b) => b.count - a.count);

describe("createHeavyHitters", () => {
  it("counts exactly while it has spare counters", () => {
    const hh = createHeavyHitters(4);
    hh.add("a", 10);
    hh.add("a", 10);
    hh.add("b", 5);
    expect(ranked(hh.entries())).toEqual([
      { topic: "a", count: 2, bytes: 20 },
      { topic: "b", count: 1, bytes: 5 },
    ]);
    expect(hh.size()).toBe(2);
  });

  it("never holds more than k counters", () => {
    const hh = createHeavyHitters(3);
    for (let i = 0; i < 50; i++) hh.add(`t${i}`, 1);
    expect(hh.size()).toBe(3);
  });

  it("reads a flat tree at its true rate when the counters cover it", () => {
    // 300 topics, 7 messages each: no heavy hitter at all. With a counter free
    // for every topic there is no eviction, so the reading is exact.
    const hh = createHeavyHitters(512);
    for (let round = 0; round < 7; round++) {
      for (let t = 0; t < 300; t++) hh.add(`topic${t}`, 100);
    }
    for (const row of ranked(hh.entries())) {
      expect(row.count).toBeLessThanOrEqual(7);
      expect(row.bytes).toBeLessThanOrEqual(700);
    }
    expect(ranked(hh.entries())[0].count).toBe(7);
  });

  it("lets a loud latecomer displace the quiet topics that filled it", () => {
    const hh = createHeavyHitters(4);
    for (let i = 0; i < 100; i++) hh.add(`quiet${i}`, 1);
    for (let i = 0; i < 20; i++) hh.add("loud", 1);
    const top = ranked(hh.entries())[0];
    expect(top.topic).toBe("loud");
    expect(top.count).toBeGreaterThanOrEqual(19);
    expect(top.count).toBeLessThanOrEqual(20);
  });

  it("brackets the true count between the corrected and raw readings", () => {
    const hh = createHeavyHitters(8);
    for (let round = 0; round < 100; round++) {
      for (let i = 0; i < 20; i++) hh.add("heavy", 1);
      for (let i = 0; i < 20; i++) hh.add(`churn${round}-${i}`, 1);
    }
    const heavy = hh.entries().find((e) => e.topic === "heavy");
    expect(heavy).toBeDefined();
    expect(lowerBound(heavy!).count).toBeLessThanOrEqual(2000);
    expect(heavy!.count).toBeGreaterThanOrEqual(2000);
  });

  it("bounds the over-count by total / k", () => {
    const hh = createHeavyHitters(10);
    const total = 1000;
    for (let i = 0; i < total; i++) hh.add(`t${i % 200}`, 1);
    for (const e of hh.entries()) {
      expect(e.count - lowerBound(e).count).toBeLessThanOrEqual(total / 10);
    }
  });

  it("clears back to empty", () => {
    const hh = createHeavyHitters(4);
    hh.add("a", 1);
    hh.clear();
    expect(hh.entries()).toEqual([]);
    expect(hh.size()).toBe(0);
    hh.add("b", 2);
    expect(ranked(hh.entries())).toEqual([{ topic: "b", count: 1, bytes: 2 }]);
  });
});
