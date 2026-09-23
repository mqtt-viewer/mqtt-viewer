import { describe, it, expect } from "vitest";
import {
  MAX_WINDOW_SECONDS,
  customWindowSeconds,
  maxValueForUnit,
  parseCustomValue,
  reverseMap,
} from "./chart-custom-window";

describe("reverseMap", () => {
  it("uses the largest unit that divides the value evenly", () => {
    expect(reverseMap(172800)).toEqual({ value: 2, unit: "days" });
    expect(reverseMap(7200)).toEqual({ value: 2, unit: "hours" });
    expect(reverseMap(720)).toEqual({ value: 12, unit: "minutes" });
    expect(reverseMap(45)).toEqual({ value: 45, unit: "seconds" });
  });

  it("prefers days over hours when both divide evenly", () => {
    expect(reverseMap(86400)).toEqual({ value: 1, unit: "days" });
  });
});

describe("parseCustomValue", () => {
  it("rejects empty and non-numeric text", () => {
    expect(parseCustomValue(undefined, "seconds")).toBeNull();
    expect(parseCustomValue("", "seconds")).toBeNull();
    expect(parseCustomValue("   ", "seconds")).toBeNull();
    expect(parseCustomValue("abc", "seconds")).toBeNull();
    expect(parseCustomValue("Infinity", "seconds")).toBeNull();
  });

  it("rounds decimals to the nearest integer", () => {
    expect(parseCustomValue("1.5", "hours")).toBe(2);
    expect(parseCustomValue("1.4", "hours")).toBe(1);
    expect(parseCustomValue("2.6", "minutes")).toBe(3);
  });

  it("clamps to a minimum of 1", () => {
    expect(parseCustomValue("0", "seconds")).toBe(1);
    expect(parseCustomValue("-5", "seconds")).toBe(1);
    expect(parseCustomValue("0.2", "days")).toBe(1);
  });

  it("clamps to the per-unit maximum (366 days total)", () => {
    expect(parseCustomValue("400", "days")).toBe(366);
    expect(parseCustomValue("999999", "hours")).toBe(8784);
    expect(parseCustomValue(String(MAX_WINDOW_SECONDS + 1), "seconds")).toBe(
      MAX_WINDOW_SECONDS
    );
  });

  it("accepts in-range whole values unchanged", () => {
    expect(parseCustomValue("90", "minutes")).toBe(90);
  });
});

describe("maxValueForUnit / customWindowSeconds", () => {
  it("caps every unit at 366 days of seconds", () => {
    expect(maxValueForUnit("days")).toBe(366);
    expect(maxValueForUnit("hours")).toBe(8784);
    expect(maxValueForUnit("minutes")).toBe(527040);
    expect(maxValueForUnit("seconds")).toBe(MAX_WINDOW_SECONDS);
    expect(customWindowSeconds(maxValueForUnit("days"), "days")).toBe(
      MAX_WINDOW_SECONDS
    );
  });

  it("resolves a value/unit pair to seconds", () => {
    expect(customWindowSeconds(2, "hours")).toBe(7200);
    expect(customWindowSeconds(30, "seconds")).toBe(30);
  });
});
