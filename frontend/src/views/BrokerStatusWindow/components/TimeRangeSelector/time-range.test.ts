import { describe, it, expect } from "vitest";
import {
  MAX_RANGE_SECONDS,
  MIN_RANGE_SECONDS,
  PRESET_MINUTES,
  formatRangeLabel,
  maxRangeValueForUnit,
  parseRangeValue,
  rangeMinutes,
  reverseMapMinutes,
} from "./time-range";

describe("PRESET_MINUTES", () => {
  it("offers 1 / 5 / 15 / 60 minutes", () => {
    expect(PRESET_MINUTES).toEqual([1, 5, 15, 60]);
  });
});

describe("maxRangeValueForUnit", () => {
  it("caps every unit at one day of seconds", () => {
    expect(maxRangeValueForUnit("days")).toBe(1);
    expect(maxRangeValueForUnit("hours")).toBe(24);
    expect(maxRangeValueForUnit("minutes")).toBe(1440);
    expect(maxRangeValueForUnit("seconds")).toBe(MAX_RANGE_SECONDS);
  });

  it("never drops below one", () => {
    for (const unit of ["seconds", "minutes", "hours", "days"] as const) {
      expect(maxRangeValueForUnit(unit)).toBeGreaterThanOrEqual(
        MIN_RANGE_SECONDS
      );
    }
  });
});

describe("parseRangeValue", () => {
  it("rejects empty and non-numeric text", () => {
    expect(parseRangeValue(undefined, "seconds")).toBeNull();
    expect(parseRangeValue("", "seconds")).toBeNull();
    expect(parseRangeValue("   ", "seconds")).toBeNull();
    expect(parseRangeValue("abc", "seconds")).toBeNull();
    expect(parseRangeValue("Infinity", "seconds")).toBeNull();
  });

  it("rounds decimals to the nearest integer", () => {
    expect(parseRangeValue("1.5", "hours")).toBe(2);
    expect(parseRangeValue("1.4", "hours")).toBe(1);
    expect(parseRangeValue("2.6", "minutes")).toBe(3);
  });

  it("clamps to a minimum of 1", () => {
    expect(parseRangeValue("0", "seconds")).toBe(1);
    expect(parseRangeValue("-5", "minutes")).toBe(1);
    expect(parseRangeValue("0.2", "days")).toBe(1);
  });

  it("clamps to the one-day cap, tighter than the chart's own cap", () => {
    expect(parseRangeValue("7", "days")).toBe(1);
    expect(parseRangeValue("48", "hours")).toBe(24);
    expect(parseRangeValue("100000", "minutes")).toBe(1440);
    expect(parseRangeValue(String(MAX_RANGE_SECONDS + 1), "seconds")).toBe(
      MAX_RANGE_SECONDS
    );
  });

  it("accepts in-range whole values unchanged", () => {
    expect(parseRangeValue("45", "seconds")).toBe(45);
    expect(parseRangeValue("90", "minutes")).toBe(90);
    expect(parseRangeValue("6", "hours")).toBe(6);
  });
});

describe("rangeMinutes", () => {
  it("converts a value/unit pair to minutes", () => {
    expect(rangeMinutes(1, "minutes")).toBe(1);
    expect(rangeMinutes(2, "hours")).toBe(120);
    expect(rangeMinutes(1, "days")).toBe(1440);
  });

  it("is fractional below a minute", () => {
    expect(rangeMinutes(30, "seconds")).toBe(0.5);
    expect(rangeMinutes(45, "seconds")).toBe(0.75);
  });
});

describe("reverseMapMinutes", () => {
  it("uses the largest unit that divides the window evenly", () => {
    expect(reverseMapMinutes(1440)).toEqual({ value: 1, unit: "days" });
    expect(reverseMapMinutes(120)).toEqual({ value: 2, unit: "hours" });
    expect(reverseMapMinutes(15)).toEqual({ value: 15, unit: "minutes" });
    expect(reverseMapMinutes(0.75)).toEqual({ value: 45, unit: "seconds" });
  });

  it("round-trips through rangeMinutes", () => {
    for (const minutes of [0.5, 1, 90, 120, 1440]) {
      const { value, unit } = reverseMapMinutes(minutes);
      expect(rangeMinutes(value, unit)).toBe(minutes);
    }
  });
});

describe("formatRangeLabel", () => {
  it("renders sub-minute and fractional windows in seconds", () => {
    expect(formatRangeLabel(0.75)).toBe("45s");
    expect(formatRangeLabel(0.5)).toBe("30s");
    expect(formatRangeLabel(1 / 60)).toBe("1s");
    expect(formatRangeLabel(1.5)).toBe("90s");
  });

  it("keeps whole minutes up to and including 60 in minutes", () => {
    expect(formatRangeLabel(1)).toBe("1m");
    expect(formatRangeLabel(5)).toBe("5m");
    expect(formatRangeLabel(15)).toBe("15m");
    expect(formatRangeLabel(60)).toBe("60m");
  });

  it("switches to hours only above the 60m preset", () => {
    expect(formatRangeLabel(61)).toBe("61m");
    expect(formatRangeLabel(120)).toBe("2h");
    expect(formatRangeLabel(180)).toBe("3h");
    expect(formatRangeLabel(90)).toBe("90m");
  });

  it("renders whole days in days", () => {
    expect(formatRangeLabel(1440)).toBe("1d");
  });

  it("labels every preset", () => {
    expect(PRESET_MINUTES.map(formatRangeLabel)).toEqual([
      "1m",
      "5m",
      "15m",
      "60m",
    ]);
  });
});
