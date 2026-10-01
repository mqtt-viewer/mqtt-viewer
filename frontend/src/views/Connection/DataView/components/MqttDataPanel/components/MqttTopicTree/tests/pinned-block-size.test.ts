import { describe, expect, it } from "vitest";
import {
  pinnedBodyBounds,
  pinnedBodyCap,
  pinnedBodyHeight,
  resizedBodyCap,
} from "../pinned-block-size";

const ROW = 19;
const geometry = (containerHeight: number) => ({
  containerHeight,
  rowHeight: ROW,
  headerHeight: ROW,
  borderHeight: 1,
});
// Header and divider included: what the block takes from the panel.
const blockHeight = (body: number) => body + ROW + 1;

describe("pinnedBodyBounds", () => {
  it("defaults the whole block, header and divider included, to at most two fifths", () => {
    for (const height of [400, 401, 500, 777, 1000]) {
      const bounds = pinnedBodyBounds(geometry(height));
      expect(blockHeight(bounds.default)).toBeLessThanOrEqual(height * 0.4);
    }
    expect(pinnedBodyBounds(geometry(500)).default).toBe(180);
  });

  it("keeps four tree rows below the block when there is room", () => {
    const bounds = pinnedBodyBounds(geometry(500));
    expect(bounds.max).toBe(500 - 20 - 4 * ROW);
    expect(bounds.min).toBe(ROW);
  });

  it("lets the tree win in a short panel, down to a one-row body", () => {
    const bounds = pinnedBodyBounds(geometry(100));
    expect(bounds.max).toBe(ROW);
    expect(bounds.default).toBe(ROW);
  });

  it("uses a modest cap before the panel is measured", () => {
    const bounds = pinnedBodyBounds(geometry(0));
    expect(bounds.default).toBe(10 * ROW);
    expect(bounds.max).toBe(10 * ROW);
  });
});

describe("pinnedBodyCap", () => {
  it("uses the default until the user drags", () => {
    const bounds = pinnedBodyBounds(geometry(500));
    expect(pinnedBodyCap(null, bounds)).toBe(bounds.default);
  });

  it("clamps the user's cap to the bounds without losing it", () => {
    const tall = pinnedBodyBounds(geometry(1000));
    const short = pinnedBodyBounds(geometry(300));
    expect(pinnedBodyCap(600, tall)).toBe(600);
    expect(pinnedBodyCap(600, short)).toBe(short.max);
    expect(pinnedBodyCap(2, short)).toBe(ROW);
    // Same preference, roomier panel again: back to what was chosen.
    expect(pinnedBodyCap(600, tall)).toBe(600);
  });
});

describe("pinnedBodyHeight", () => {
  it("is the rows' height up to the cap, never empty space", () => {
    expect(pinnedBodyHeight(3, ROW, 200)).toBe(3 * ROW);
    expect(pinnedBodyHeight(30, ROW, 200)).toBe(200);
    expect(pinnedBodyHeight(0, ROW, 200)).toBe(0);
  });
});

describe("resizedBodyCap", () => {
  const bounds = pinnedBodyBounds(geometry(662));
  const resize = (
    desired: number,
    rows: number,
    preferred: number | null
  ) =>
    resizedBodyCap({
      desired,
      rowHeight: ROW,
      contentHeight: rows * ROW,
      cap: pinnedBodyCap(preferred, bounds),
      preferred,
      bounds,
    });

  it("snaps to whole rows", () => {
    expect(resize(100, 46, null)).toBe(5 * ROW);
    expect(resize(22, 46, null)).toBe(ROW);
  });

  it("takes a smaller cap when the block is dragged below its rows", () => {
    expect(resize(5 * ROW, 46, 12 * ROW)).toBe(5 * ROW);
  });

  it("takes a larger cap when there are rows left to show", () => {
    expect(resize(13 * ROW, 46, 12 * ROW)).toBe(13 * ROW);
  });

  it("leaves the cap alone when a block that shows every row is nudged", () => {
    // A collapsed pin is one row. Stepping or wobbling the divider under it
    // must not shrink the cap it reopens to.
    expect(resize(2 * ROW, 1, 379)).toBe(379);
    expect(resize(0, 1, 379)).toBe(379);
    expect(resize(ROW + 3, 1, null)).toBeNull();
  });

  it("still raises the cap past the one in force", () => {
    expect(resize(20 * ROW, 3, 10 * ROW)).toBe(20 * ROW);
  });

  it("never leaves the bounds", () => {
    expect(resize(5000, 500, null)).toBe(bounds.max);
    expect(resize(-50, 500, null)).toBe(bounds.min);
  });
});
