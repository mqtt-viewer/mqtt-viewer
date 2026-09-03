import { describe, expect, it } from "vitest";
import {
  computeDropIndex,
  edgeScrollSpeed,
  insertId,
  isSameSpot,
  orderAfterMove,
  reorderIds,
} from "./drop-index";

// Three 20px rows stacked from y=0, so midpoints sit at 10, 30 and 50.
const rows = [
  { top: 0, bottom: 20 },
  { top: 20, bottom: 40 },
  { top: 40, bottom: 60 },
];

describe("computeDropIndex", () => {
  it("puts an empty list at index 0", () => {
    expect(computeDropIndex(123, [])).toBe(0);
  });

  it("drops before a row above its midpoint", () => {
    expect(computeDropIndex(0, rows)).toBe(0);
    expect(computeDropIndex(9, rows)).toBe(0);
    expect(computeDropIndex(29, rows)).toBe(1);
  });

  it("drops after a row below its midpoint", () => {
    expect(computeDropIndex(10, rows)).toBe(1);
    expect(computeDropIndex(30, rows)).toBe(2);
    expect(computeDropIndex(50, rows)).toBe(3);
  });

  it("clamps past the last row to the end", () => {
    expect(computeDropIndex(9999, rows)).toBe(3);
  });

  it("does not care about gaps between rows", () => {
    const spaced = [
      { top: 0, bottom: 10 },
      { top: 30, bottom: 40 },
    ];
    expect(computeDropIndex(20, spaced)).toBe(1);
  });
});

describe("reorderIds", () => {
  it("moves an item down", () => {
    expect(reorderIds([1, 2, 3, 4], 0, 3)).toEqual([2, 3, 1, 4]);
  });

  it("moves an item to the end", () => {
    expect(reorderIds([1, 2, 3, 4], 0, 4)).toEqual([2, 3, 4, 1]);
  });

  it("moves an item up", () => {
    expect(reorderIds([1, 2, 3, 4], 3, 1)).toEqual([1, 4, 2, 3]);
  });

  it("moves an item to the front", () => {
    expect(reorderIds([1, 2, 3, 4], 2, 0)).toEqual([3, 1, 2, 4]);
  });

  it("leaves the list alone for either gap touching the item", () => {
    expect(reorderIds([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(reorderIds([1, 2, 3], 1, 2)).toEqual([1, 2, 3]);
  });

  it("returns a copy when the index is not in the list", () => {
    const ids = [1, 2];
    expect(reorderIds(ids, -1, 0)).toEqual([1, 2]);
    expect(reorderIds(ids, 5, 0)).not.toBe(ids);
  });
});

describe("insertId", () => {
  it("inserts into an empty list", () => {
    expect(insertId([], 7, 0)).toEqual([7]);
  });

  it("inserts at a gap", () => {
    expect(insertId([1, 2, 3], 7, 0)).toEqual([7, 1, 2, 3]);
    expect(insertId([1, 2, 3], 7, 2)).toEqual([1, 2, 7, 3]);
    expect(insertId([1, 2, 3], 7, 3)).toEqual([1, 2, 3, 7]);
  });

  it("clamps an index past the end", () => {
    expect(insertId([1, 2], 7, 99)).toEqual([1, 2, 7]);
  });

  it("never duplicates an id that is somehow already there", () => {
    expect(insertId([1, 2, 3], 2, 0)).toEqual([2, 1, 3]);
  });
});

describe("isSameSpot", () => {
  it("is true for both gaps touching the item", () => {
    expect(isSameSpot(2, 2)).toBe(true);
    expect(isSameSpot(2, 3)).toBe(true);
  });

  it("is false anywhere else", () => {
    expect(isSameSpot(2, 1)).toBe(false);
    expect(isSameSpot(2, 4)).toBe(false);
  });
});

describe("edgeScrollSpeed", () => {
  const rect = { top: 100, bottom: 500 };

  it("does not scroll in the middle", () => {
    expect(edgeScrollSpeed(300, rect, 48, 14)).toBe(0);
  });

  it("scrolls up near the top, faster closer to it", () => {
    const near = edgeScrollSpeed(140, rect, 48, 14);
    const nearer = edgeScrollSpeed(105, rect, 48, 14);
    expect(near).toBeLessThan(0);
    expect(nearer).toBeLessThan(near);
  });

  it("scrolls down near the bottom", () => {
    expect(edgeScrollSpeed(490, rect, 48, 14)).toBeGreaterThan(0);
  });

  it("caps at the maximum speed past the edge", () => {
    expect(edgeScrollSpeed(50, rect, 48, 14)).toBe(-14);
    expect(edgeScrollSpeed(600, rect, 48, 14)).toBe(14);
  });
});

describe("orderAfterMove", () => {
  it("reorders within a list", () => {
    expect(orderAfterMove([1, 2, 3], 1, true, 3)).toEqual([2, 3, 1]);
  });

  it("appends within a list when there is no index", () => {
    expect(orderAfterMove([1, 2, 3], 1, true, null)).toEqual([2, 3, 1]);
  });

  it("changes nothing when the item is already in that gap", () => {
    expect(orderAfterMove([1, 2, 3], 2, true, 1)).toBeNull();
    expect(orderAfterMove([1, 2, 3], 2, true, 2)).toBeNull();
    expect(orderAfterMove([1, 2, 3], 3, true, null)).toBeNull();
  });

  it("inserts an item coming from another list", () => {
    expect(orderAfterMove([1, 2, 3], 9, false, 1)).toEqual([1, 9, 2, 3]);
  });

  it("appends an item coming from another list when there is no index", () => {
    expect(orderAfterMove([1, 2, 3], 9, false, null)).toEqual([1, 2, 3, 9]);
  });

  it("inserts into an empty list", () => {
    expect(orderAfterMove([], 9, false, 0)).toEqual([9]);
    expect(orderAfterMove([], 9, false, null)).toEqual([9]);
  });
});
