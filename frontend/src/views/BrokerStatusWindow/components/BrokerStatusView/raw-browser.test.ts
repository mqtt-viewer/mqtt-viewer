import { describe, it, expect } from "vitest";
import { createRawRateTracker, formatAge } from "./raw-browser";

const T0 = 1_000_000_000;

describe("formatAge", () => {
  it("scales from seconds to days and clamps future times", () => {
    expect(formatAge(T0, T0 - 3000)).toBe("3s ago");
    expect(formatAge(T0, T0 - 300_000)).toBe("5m ago");
    expect(formatAge(T0, T0 - 7_200_000)).toBe("2h ago");
    expect(formatAge(T0, T0 + 5000)).toBe("0s ago");
  });
});

describe("createRawRateTracker", () => {
  it("derives a rate once a counter has strictly increased three times", () => {
    const t = createRawRateTracker();
    expect(t.update("$SYS/broker/messages/sent", "10", T0)).toBeNull();
    expect(t.update("$SYS/broker/messages/sent", "20", T0 + 1000)).toBeNull();
    expect(t.update("$SYS/broker/messages/sent", "30", T0 + 2000)).toBe(10);
  });

  it("never classifies a stable gauge as a counter", () => {
    const t = createRawRateTracker();
    const topic = "$SYS/broker/subscriptions/count";
    for (let i = 0; i < 6; i++) {
      expect(t.update(topic, "12", T0 + i * 1000)).toBeNull();
    }
  });

  it("excludes the $SYS load subtree, which is all moving averages", () => {
    const t = createRawRateTracker();
    const topic = "$SYS/broker/load/bytes/sent/15min";
    for (let i = 0; i < 6; i++) {
      expect(t.update(topic, String(100 + i * 10), T0 + i * 1000)).toBeNull();
    }
  });

  it("drops the rate when a counter resets, then re-derives one", () => {
    const t = createRawRateTracker();
    const topic = "$SYS/broker/messages/received";
    t.update(topic, "10", T0);
    t.update(topic, "20", T0 + 1000);
    expect(t.update(topic, "30", T0 + 2000)).toBe(10);
    expect(t.update(topic, "0", T0 + 3000)).toBeNull(); // broker restart
    t.update(topic, "5", T0 + 4000);
    expect(t.update(topic, "10", T0 + 5000)).toBe(5);
  });

  it("is idempotent for a repeated observation", () => {
    const t = createRawRateTracker();
    const topic = "$SYS/broker/messages/sent";
    t.update(topic, "10", T0);
    t.update(topic, "20", T0 + 1000);
    expect(t.update(topic, "30", T0 + 2000)).toBe(10);
    expect(t.update(topic, "30", T0 + 2000)).toBe(10);
  });
});
