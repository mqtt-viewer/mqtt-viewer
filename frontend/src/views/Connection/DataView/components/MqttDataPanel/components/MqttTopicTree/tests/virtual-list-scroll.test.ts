import { describe, expect, it } from "vitest";
import { createShrinkClamp, maxScrollTop } from "../virtual-list-scroll";

const ROW = 19;

// Just enough of a container and its virtual-list viewport for the clamp.
const fakeList = (scrollTop: number, clientHeight: number) => {
  const viewport = { scrollTop, clientHeight };
  const container = {
    querySelector: (tag: string) =>
      tag === "svelte-virtual-list-viewport" ? viewport : null,
  } as unknown as Element;
  return { viewport, container };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("maxScrollTop", () => {
  it("is the rows' height less the viewport, never negative", () => {
    expect(maxScrollTop(100, ROW, 190)).toBe(1900 - 190);
    expect(maxScrollTop(5, ROW, 190)).toBe(0);
  });
});

describe("createShrinkClamp", () => {
  it("pulls the scroll back inside the list when it shrinks", async () => {
    const { viewport, container } = fakeList(1500, 190);
    const onRowCount = createShrinkClamp(() => container, ROW);
    onRowCount(100);
    onRowCount(20);
    await settle();
    expect(viewport.scrollTop).toBe(20 * ROW - 190);
  });

  it("leaves the scroll alone when growing, or shrinking within reach", async () => {
    const { viewport, container } = fakeList(100, 190);
    const onRowCount = createShrinkClamp(() => container, ROW);
    onRowCount(100);
    onRowCount(200);
    onRowCount(50);
    await settle();
    expect(viewport.scrollTop).toBe(100);
  });

  it("leaves an emptied list to its caller", async () => {
    const { viewport, container } = fakeList(900, 190);
    const onRowCount = createShrinkClamp(() => container, ROW);
    onRowCount(100);
    onRowCount(0);
    await settle();
    expect(viewport.scrollTop).toBe(900);
  });
});
