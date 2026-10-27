import { describe, expect, it } from "vitest";
import { resolveGroupDrop } from "./resolve-group-drop";

// No DOM in the node test environment, so fake just the part of Element the
// resolver uses: closest() returning the section root (or null).
const inside = (value: string) => ({
  closest: (selector: string) =>
    selector === "[data-group-drop]" ? { getAttribute: () => value } : null,
});
const outside = { closest: () => null };

describe("resolveGroupDrop", () => {
  it("reads a group id from the nearest section", () => {
    expect(resolveGroupDrop(inside("7"))).toEqual({ groupId: 7 });
  });

  it("maps the Ungrouped section to a null group", () => {
    expect(resolveGroupDrop(inside("ungrouped"))).toEqual({ groupId: null });
  });

  it("returns null outside any section", () => {
    expect(resolveGroupDrop(outside)).toBeNull();
  });

  it("returns null for no element", () => {
    expect(resolveGroupDrop(null)).toBeNull();
  });

  it("returns null for an attribute that is not a group", () => {
    expect(resolveGroupDrop(inside("abc"))).toBeNull();
    expect(resolveGroupDrop(inside("0"))).toBeNull();
    expect(resolveGroupDrop(inside("-3"))).toBeNull();
    expect(resolveGroupDrop(inside("1.5"))).toBeNull();
  });
});
