import { describe, it, expect } from "vitest";
import {
  applyHysteresis,
  evaluateHealth,
  isRising,
  HYSTERESIS_MIN_MS,
  type HealthChip,
  type HealthChipId,
  type HealthChipState,
  type HealthMetric,
  type TrendSample,
} from "./health";

const NOW = 1_000_000_000;

// Build a sample trail ending at `now`, one point per `cadenceMs`, in time
// order (oldest first) — the shape the store's runtime produces.
const series = (
  values: number[],
  cadenceMs: number,
  now = NOW
): TrendSample[] =>
  values.map((v, i) => ({
    t: now - (values.length - 1 - i) * cadenceMs,
    v,
  }));

const metric = (
  value: number | null,
  samples: TrendSample[]
): HealthMetric => ({ value, samples });

const chipsById = (chips: HealthChip[]): Record<string, HealthChip> =>
  Object.fromEntries(chips.map((c) => [c.id, c]));

const evalHealth = (
  inputs: Parameters<typeof evaluateHealth>[0],
  interval: number,
  prev: Map<HealthChipId, HealthChipState> = new Map(),
  now = NOW
) => chipsById(evaluateHealth(inputs, prev, now, interval).chips);

// --- isRising: cadence-robust trend ------------------------------------------

describe("isRising", () => {
  it("rises on 3 strictly increasing in-window samples (10 s cadence)", () => {
    expect(isRising(series([1, 2, 3], 10_000), NOW, 60_000, 10_000)).toBe(true);
  });

  it("does not rise when the value held flat", () => {
    expect(isRising(series([3, 3, 3], 10_000), NOW, 60_000, 10_000)).toBe(false);
  });

  it("needs at least 3 in-window samples", () => {
    expect(isRising(series([1, 2], 10_000), NOW, 60_000, 10_000)).toBe(false);
  });

  it("is false when the newest sample is older than 2x the interval", () => {
    // 3 rising samples but the freshest is 30 s old at a 10 s interval.
    const stale = series([1, 2, 3], 10_000, NOW - 30_000);
    expect(isRising(stale, NOW, 60_000, 10_000)).toBe(false);
  });

  it("uses max(ruleWindow, 3x interval) so a 60 s cadence still qualifies", () => {
    // At a 60 s interval, 3 samples span 120 s — inside the 180 s effective
    // window (3 × 60 s), and the fixed 60 s rule window alone would exclude the
    // two older points.
    expect(isRising(series([1, 2, 3], 60_000), NOW, 60_000, 60_000)).toBe(true);
  });

  it("holds for a 20 s cadence", () => {
    expect(isRising(series([5, 7, 9, 11], 20_000), NOW, 60_000, 20_000)).toBe(
      true
    );
  });
});

// --- applyHysteresis ---------------------------------------------------------

describe("applyHysteresis", () => {
  const hold = HYSTERESIS_MIN_MS;

  it("adopts the first level immediately", () => {
    const s = applyHysteresis(undefined, "problem", NOW, hold);
    expect(s.level).toBe("problem");
    expect(s.since).toBe(NOW);
  });

  it("upgrades immediately and clears any pending downgrade", () => {
    const prev: HealthChipState = {
      level: "attention",
      since: NOW - 5000,
      pendingLevel: "ok",
      pendingSince: NOW - 1000,
    };
    const s = applyHysteresis(prev, "problem", NOW, hold);
    expect(s.level).toBe("problem");
    expect(s.pendingLevel).toBeNull();
  });

  it("holds a downgrade until the lower level persists for holdMs", () => {
    const start: HealthChipState = {
      level: "problem",
      since: NOW,
      pendingLevel: null,
      pendingSince: 0,
    };
    // Raw drops to ok: begins the hold, still shows problem.
    const s1 = applyHysteresis(start, "ok", NOW + 1000, hold);
    expect(s1.level).toBe("problem");
    expect(s1.pendingLevel).toBe("ok");

    // Just before the hold elapses: still problem.
    const s2 = applyHysteresis(s1, "ok", NOW + 1000 + hold - 1, hold);
    expect(s2.level).toBe("problem");

    // Hold elapsed: now ok.
    const s3 = applyHysteresis(s1, "ok", NOW + 1000 + hold, hold);
    expect(s3.level).toBe("ok");
  });

  it("restarts the hold if the raw level bounces back up mid-hold", () => {
    const start: HealthChipState = {
      level: "problem",
      since: NOW,
      pendingLevel: null,
      pendingSince: 0,
    };
    const holding = applyHysteresis(start, "ok", NOW + 1000, hold);
    const bounced = applyHysteresis(holding, "problem", NOW + 2000, hold);
    expect(bounced.level).toBe("problem");
    expect(bounced.pendingLevel).toBeNull();
  });
});

// --- evaluateHealth: rendering + minimum samples -----------------------------

describe("evaluateHealth — rendering gate", () => {
  it("renders nothing for a chip with no samples", () => {
    const chips = evalHealth({ msgs_dropped: metric(null, []) }, 10_000);
    expect(chips.drops.render).toBe(false);
    expect(chips.drops.level).toBeNull();
  });

  it("renders ok from one gauge sample (change-only republishers never re-emit a flat zero)", () => {
    const chips = evalHealth(
      { msgs_dropped: metric(0, series([0], 10_000)) },
      10_000
    );
    expect(chips.drops.render).toBe(true);
    expect(chips.drops.level).toBe("ok");
  });

  it("one backlog gauge sample at 60 s cadence renders without a trend state", () => {
    const chips = evalHealth(
      { delivery_backlog: metric(7, series([7], 60_000)) },
      60_000
    );
    expect(chips.backlog.render).toBe(true);
    expect(chips.backlog.level).toBe("ok");
  });
});

// --- evaluateHealth: Drops ---------------------------------------------------

describe("evaluateHealth — Drops", () => {
  it("ok when the drop rate is zero", () => {
    const chips = evalHealth(
      { msgs_dropped: metric(0, series([0, 0], 10_000)) },
      10_000
    );
    expect(chips.drops.level).toBe("ok");
    expect(chips.drops.qualifier).toBe("");
  });

  it("attention when dropping steadily but not rising", () => {
    const chips = evalHealth(
      { msgs_dropped: metric(2, series([2, 2], 10_000)) },
      10_000
    );
    expect(chips.drops.level).toBe("attention");
    expect(chips.drops.qualifier).toBe("present");
  });

  it("problem when the drop rate is rising", () => {
    const chips = evalHealth(
      { msgs_dropped: metric(3, series([1, 2, 3], 10_000)) },
      10_000
    );
    expect(chips.drops.level).toBe("problem");
    expect(chips.drops.qualifier).toBe("rising");
  });

  it("problem when drops exceed 5% of inbound (flat, guarded by inbound >= 1)", () => {
    const chips = evalHealth(
      {
        msgs_dropped: metric(5, series([5, 5], 10_000)),
        msg_rate_in: metric(50, series([50, 50], 10_000)),
      },
      10_000
    );
    expect(chips.drops.level).toBe("problem");
  });

  it("never fires the relative rule on inbound below 1 msg/s", () => {
    const chips = evalHealth(
      {
        msgs_dropped: metric(5, series([5, 5], 10_000)),
        msg_rate_in: metric(0.5, series([0.5, 0.5], 10_000)),
      },
      10_000
    );
    expect(chips.drops.level).toBe("attention"); // not problem
  });
});

// --- evaluateHealth: Delivery backlog ----------------------------------------

describe("evaluateHealth — Delivery backlog", () => {
  it("ok on an idle plateau (packet/out/count flat)", () => {
    const chips = evalHealth(
      { delivery_backlog: metric(10, series([10, 10, 10, 10], 10_000)) },
      10_000
    );
    expect(chips.backlog.level).toBe("ok");
  });

  it("attention when rising only inside the 60 s window", () => {
    // Flat for the first ~60 s (inside the 120 s problem window), rising only in
    // the last 60 s → the attention window sees a rise, the problem window sees
    // an earlier plateau.
    const values = [10, 10, 10, 10, 10, 10, 10, 11, 12, 13, 14, 15, 16];
    const chips = evalHealth(
      { delivery_backlog: metric(16, series(values, 10_000)) },
      10_000
    );
    expect(chips.backlog.level).toBe("attention");
  });

  it("problem when rising across the whole 120 s window", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    const chips = evalHealth(
      { delivery_backlog: metric(13, series(values, 10_000)) },
      10_000
    );
    expect(chips.backlog.level).toBe("problem");
  });
});

// --- evaluateHealth: Store (never red), Heap + Churn (informational) ---------

describe("evaluateHealth — Store / Heap / Churn", () => {
  it("store goes attention while rising and never problem", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    const chips = evalHealth(
      { store_msgs: metric(13, series(values, 10_000)) },
      10_000
    );
    expect(chips.store.level).toBe("attention");
  });

  it("store ok when flat", () => {
    const chips = evalHealth(
      { store_msgs: metric(5, series([5, 5, 5], 10_000)) },
      10_000
    );
    expect(chips.store.level).toBe("ok");
  });

  it("heap is informational: value + peak, no state dot", () => {
    const chips = evalHealth(
      {
        heap_current: metric(8_200_000, series([8_000_000, 8_200_000], 10_000)),
        heap_max: metric(9_100_000, series([9_100_000, 9_100_000], 10_000)),
      },
      10_000
    );
    expect(chips.heap.informational).toBe(true);
    expect(chips.heap.level).toBeNull();
    expect(chips.heap.value).toBe(8_200_000);
    expect(chips.heap.detail).toBe(9_100_000);
  });

  it("churn is informational", () => {
    const chips = evalHealth(
      { sockets_1min: metric(1.5, series([1.5, 1.5], 10_000)) },
      10_000
    );
    expect(chips.churn.informational).toBe(true);
    expect(chips.churn.value).toBe(1.5);
  });
});

// --- evaluateHealth: staleness ------------------------------------------------

describe("evaluateHealth — staleness", () => {
  it("greys a chip whose source has been silent past 3x interval + 30 s", () => {
    // Newest sample 200 s old at a 10 s interval → threshold 60 s → stale.
    const chips = evalHealth(
      { store_msgs: metric(5, series([5, 5], 10_000, NOW - 200_000)) },
      10_000
    );
    expect(chips.store.render).toBe(true);
    expect(chips.store.stale).toBe(true);
    expect(chips.store.qualifier).toBe(""); // qualifier drops when stale
  });

  it("is not stale while samples arrive within the threshold", () => {
    const chips = evalHealth(
      { store_msgs: metric(5, series([5, 5], 10_000)) },
      10_000
    );
    expect(chips.store.stale).toBe(false);
  });
});

// --- evaluateHealth: hysteresis persistence via the state map ----------------

describe("evaluateHealth — hysteresis across ticks", () => {
  it("holds a problem→ok downgrade for max(30 s, interval)", () => {
    const rising = series([1, 2, 3], 10_000);
    // Tick 1: rising drops → problem.
    const first = evaluateHealth(
      { msgs_dropped: metric(3, rising) },
      new Map(),
      NOW,
      10_000
    );
    expect(chipsById(first.chips).drops.level).toBe("problem");

    // Tick 2 (+1 s): drops cleared to flat zero → still problem (hysteresis).
    const flatZero = series([0, 0], 10_000, NOW + 1000);
    const second = evaluateHealth(
      { msgs_dropped: metric(0, flatZero) },
      first.states,
      NOW + 1000,
      10_000
    );
    expect(chipsById(second.chips).drops.level).toBe("problem");

    // Tick 3 (+31 s from the clear): the 30 s hold elapsed → ok.
    const later = series([0, 0], 10_000, NOW + 32_000);
    const third = evaluateHealth(
      { msgs_dropped: metric(0, later) },
      second.states,
      NOW + 32_000,
      10_000
    );
    expect(chipsById(third.chips).drops.level).toBe("ok");
  });
});
