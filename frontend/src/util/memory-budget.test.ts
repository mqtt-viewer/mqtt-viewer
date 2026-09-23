import { describe, expect, it } from "vitest";
import {
  MB,
  budgetFactor,
  estimateTotalBytes,
  formatBytes,
  type MemoryLimitModel,
} from "./memory-budget";

// Matches memoryLimitModel in backend/app/memlimit.go: 1 GiB base plus 3/2 of
// the budget for each connected connection.
const model: MemoryLimitModel = {
  baseBytes: 1024 * MB,
  budgetFactorNumerator: 3,
  budgetFactorDenominator: 2,
};

describe("estimateTotalBytes", () => {
  // backend/app/memlimit_test.go pins these same numbers against
  // computeMemoryLimit. If one side changes, both must.
  it("matches the backend limit at the default 512 MB budget", () => {
    expect(estimateTotalBytes(model, 512, 1)).toBe(1879048192);
    expect(estimateTotalBytes(model, 512, 2)).toBe(2684354560);
    expect(estimateTotalBytes(model, 512, 3)).toBe(3489660928);
  });

  it("is just the base with no connections", () => {
    expect(estimateTotalBytes(model, 512, 0)).toBe(1073741824);
  });

  it("is undefined until the model has loaded", () => {
    expect(estimateTotalBytes(undefined, 512, 1)).toBeUndefined();
  });
});

describe("budgetFactor", () => {
  it("reads as 1.5 for the real model", () => {
    expect(budgetFactor(model)).toBe(1.5);
  });

  // It goes straight into a sentence, so it must not print a recurring decimal.
  it("rounds a ratio that does not divide evenly", () => {
    expect(
      budgetFactor({
        baseBytes: 1024 * MB,
        budgetFactorNumerator: 7,
        budgetFactorDenominator: 3,
      })
    ).toBe(2.33);
  });
});

describe("formatBytes", () => {
  it("formats the estimates the dialog shows", () => {
    expect(formatBytes(2684354560)).toBe("2.5 GB");
    expect(formatBytes(1879048192)).toBe("1.8 GB");
    expect(formatBytes(1024 * MB)).toBe("1 GB");
  });

  it("shows a placeholder for an unknown figure", () => {
    expect(formatBytes(undefined)).toBe("…");
  });
});
