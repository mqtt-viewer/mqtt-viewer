import { describe, expect, it } from "vitest";
import { highlightParts } from "./highlight";

describe("highlightParts", () => {
  it("splits around a literal match", () => {
    expect(highlightParts("mqtt://192.168.10.21:1883", "168.10")).toEqual([
      { text: "mqtt://192.", match: false },
      { text: "168.10", match: true },
      { text: ".21:1883", match: false },
    ]);
  });

  it("is case-insensitive and keeps the original casing", () => {
    expect(highlightParts("Line PLC", "plc")).toEqual([
      { text: "Line ", match: false },
      { text: "PLC", match: true },
    ]);
  });

  it("marks every occurrence", () => {
    const parts = highlightParts("aXaXa", "x");
    expect(parts.filter((p) => p.match)).toHaveLength(2);
    expect(parts.map((p) => p.text).join("")).toBe("aXaXa");
  });

  it("returns the whole text unmatched for an empty or blank search", () => {
    expect(highlightParts("abc", "")).toEqual([{ text: "abc", match: false }]);
    expect(highlightParts("abc", "  ")).toEqual([{ text: "abc", match: false }]);
  });
});
