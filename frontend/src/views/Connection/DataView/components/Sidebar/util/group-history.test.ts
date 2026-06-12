import { describe, expect, it } from "vitest";
import { getRecencyLabel, groupByRecency } from "./group-history";

// Friday June 12 2026, mid-afternoon
const now = new Date(2026, 5, 12, 15, 0, 0);

const daysAgo = (n: number, hour = 10) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
};

describe("getRecencyLabel", () => {
  it("labels today and yesterday", () => {
    expect(getRecencyLabel(now, now)).toBe("Today");
    expect(getRecencyLabel(daysAgo(1), now)).toBe("Yesterday");
  });

  it("labels earlier days this week with their weekday name", () => {
    expect(getRecencyLabel(daysAgo(2), now)).toBe("Wednesday");
    expect(getRecencyLabel(daysAgo(4), now)).toBe("Monday");
    expect(getRecencyLabel(daysAgo(5), now)).toBe("Sunday");
  });

  it("labels the previous calendar week as Last week", () => {
    expect(getRecencyLabel(daysAgo(6), now)).toBe("Last week");
    expect(getRecencyLabel(daysAgo(12), now)).toBe("Last week");
  });

  it("labels anything before last week as Older", () => {
    expect(getRecencyLabel(daysAgo(13), now)).toBe("Older");
    expect(getRecencyLabel(daysAgo(200), now)).toBe("Older");
  });
});

describe("groupByRecency", () => {
  it("groups sorted items into ordered buckets", () => {
    const items = [
      { at: daysAgo(0) },
      { at: daysAgo(0) },
      { at: daysAgo(2) },
      { at: daysAgo(8) },
      { at: daysAgo(40) },
    ];
    const groups = groupByRecency(items, (i) => i.at, now);
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Wednesday",
      "Last week",
      "Older",
    ]);
    expect(groups[0].items).toHaveLength(2);
  });

  it("returns no groups for no items", () => {
    expect(groupByRecency([], () => now, now)).toEqual([]);
  });
});
