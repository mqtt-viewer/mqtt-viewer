import { describe, expect, it } from "vitest";
import {
  BYTES_PER_MESSAGE_ESTIMATE,
  estimateRetentionSeconds,
  formatRetentionDuration,
} from "./retention-estimates";

const GIB = 1024 * 1024 * 1024;

describe("estimateRetentionSeconds", () => {
  it("divides the budget by message size and rate", () => {
    expect(estimateRetentionSeconds(BYTES_PER_MESSAGE_ESTIMATE * 600, 10)).toBe(
      60
    );
  });

  it("returns 0 for non-positive budgets", () => {
    expect(estimateRetentionSeconds(0, 100)).toBe(0);
    expect(estimateRetentionSeconds(-1, 100)).toBe(0);
  });

  it("returns 0 for non-positive rates", () => {
    expect(estimateRetentionSeconds(GIB, 0)).toBe(0);
    expect(estimateRetentionSeconds(GIB, -5)).toBe(0);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(estimateRetentionSeconds(NaN, 100)).toBe(0);
    expect(estimateRetentionSeconds(Infinity, 100)).toBe(0);
    expect(estimateRetentionSeconds(GIB, NaN)).toBe(0);
  });
});

describe("formatRetentionDuration", () => {
  it("treats zero and non-finite values as no history", () => {
    expect(formatRetentionDuration(0)).toBe("no history");
    expect(formatRetentionDuration(-10)).toBe("no history");
    expect(formatRetentionDuration(NaN)).toBe("no history");
    expect(formatRetentionDuration(Infinity)).toBe("no history");
  });

  it("reports under a minute", () => {
    expect(formatRetentionDuration(1)).toBe("less than a minute");
    expect(formatRetentionDuration(59)).toBe("less than a minute");
  });

  it("reports minutes up to 55 minutes", () => {
    expect(formatRetentionDuration(60)).toBe("about 1 minute");
    expect(formatRetentionDuration(90)).toBe("about 2 minutes");
    expect(formatRetentionDuration(54 * 60)).toBe("about 54 minutes");
  });

  it("rounds near-hour durations to hours", () => {
    expect(formatRetentionDuration(55 * 60)).toBe("about 1 hour");
    expect(formatRetentionDuration(2 * 3600)).toBe("about 2 hours");
    expect(formatRetentionDuration(48 * 3600 - 1)).toBe("about 48 hours");
  });

  it("reports days from 48 hours", () => {
    expect(formatRetentionDuration(48 * 3600)).toBe("about 2 days");
    expect(formatRetentionDuration(10 * 24 * 3600)).toBe("about 10 days");
  });

  it("gives realistic estimates for 1 GiB", () => {
    expect(formatRetentionDuration(estimateRetentionSeconds(GIB, 1000))).toBe(
      "about 1 hour"
    );
    expect(formatRetentionDuration(estimateRetentionSeconds(GIB, 100))).toBe(
      "about 10 hours"
    );
    expect(formatRetentionDuration(estimateRetentionSeconds(GIB, 10))).toBe(
      "about 4 days"
    );
  });
});
