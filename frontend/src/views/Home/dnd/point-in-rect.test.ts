import { describe, expect, it } from "vitest";
import { pointInRect } from "./point-in-rect";

const rect = { left: 10, top: 20, right: 110, bottom: 80 };

describe("pointInRect", () => {
  it("is true inside", () => {
    expect(pointInRect(50, 50, rect)).toBe(true);
  });

  it("counts the edges and corners as inside", () => {
    expect(pointInRect(10, 50, rect)).toBe(true);
    expect(pointInRect(110, 50, rect)).toBe(true);
    expect(pointInRect(50, 20, rect)).toBe(true);
    expect(pointInRect(50, 80, rect)).toBe(true);
    expect(pointInRect(10, 20, rect)).toBe(true);
  });

  it("is false outside", () => {
    expect(pointInRect(9, 50, rect)).toBe(false);
    expect(pointInRect(111, 50, rect)).toBe(false);
    expect(pointInRect(50, 19, rect)).toBe(false);
    expect(pointInRect(50, 81, rect)).toBe(false);
  });
});
