// Pure health rules for the Broker Status window's health strip. The store
// evaluates these on its 1 s tick and keeps the returned per-chip state
// (hysteresis timestamps live in the store, are passed back in, and are cleared
// by resetData). Nothing here reads a store or the clock — `now` and the
// learned $SYS interval are always passed in, so every rule is deterministic
// and unit-testable against fixed sample fixtures.
//
// Cadence-robust trend semantics (identical for every trend chip, so a 60 s
// EMQX broker and a 10 s mosquitto are judged on the same footing):
//   - effective window = max(ruleWindow, 3 × learnedInterval)
//   - "rising" needs ≥ 3 samples inside that window, strictly increasing, AND
//     the newest sample no older than 2 × learnedInterval (a stale series is
//     not "rising", it is silent);
//   - with < 3 in-window samples the trend clause is simply false — the state
//     falls back to its non-trend column, never "hold previous";
//   - a missing new sample means the value held flat (change-only
//     republishers like mosquitto only re-emit changed values, so silence is
//     signal, not a gap);
//   - a chip renders nothing until it has ≥ 2 samples.
//
// See the health table in docs/broker-status-v2-spec.md.

/** One value-over-time sample. Structurally the store's SparklineSample. */
export interface TrendSample {
  t: number;
  v: number;
}

/** What the store hands each chip evaluator: current value + its sample trail. */
export interface HealthMetric {
  value: number | null;
  samples: readonly TrendSample[];
}

export type HealthLevel = "ok" | "attention" | "problem";

export type HealthChipId =
  | "drops"
  | "backlog"
  | "heap"
  | "store"
  | "churn";

/** Minimum samples before a chip renders at all (never paint "ok" off one). */
export const MIN_RENDER_SAMPLES = 2;
/** A trend clause needs at least this many in-window samples to be considered. */
export const TREND_MIN_SAMPLES = 3;
/** Hysteresis floor; the effective hold is max(this, learnedInterval). */
export const HYSTERESIS_MIN_MS = 30_000;
/** A chip greys out once its source has been silent this long. */
export const STALE_EXTRA_MS = 30_000; // added to 3 × learnedInterval

const RANK: Record<HealthLevel, number> = { ok: 0, attention: 1, problem: 2 };

/**
 * Persisted per-chip hysteresis state. `level`/`since` are the displayed level
 * and when it began; `pendingLevel`/`pendingSince` track a lower level that is
 * waiting out the hysteresis hold before it may take effect.
 */
export interface HealthChipState {
  level: HealthLevel;
  since: number;
  pendingLevel: HealthLevel | null;
  pendingSince: number;
}

/** A rendered chip (or a placeholder with render:false while below min samples). */
export interface HealthChip {
  id: HealthChipId;
  label: string;
  /** null for the informational chips (heap, churn) that never carry a dot. */
  level: HealthLevel | null;
  /** Value-only chips with no state dot (heap, churn). */
  informational: boolean;
  /** One-word text qualifier; "" for ok / informational / stale. */
  qualifier: string;
  /** Primary numeric value (rate, count, or bytes depending on the chip). */
  value: number | null;
  /** Secondary numeric (heap peak); null otherwise. */
  detail: number | null;
  /** Epoch ms the current level began (for "since" copy). */
  since: number;
  /** Source has been silent past the stale threshold: keep value, drop dot. */
  stale: boolean;
  /** False until the chip has its minimum samples; the strip skips it. */
  render: boolean;
}

/**
 * True when `samples` are rising over the effective window: ≥ 3 strictly
 * increasing in-window samples with a fresh newest point. See the module
 * header for the full semantics.
 */
export function isRising(
  samples: readonly TrendSample[],
  now: number,
  ruleWindowMs: number,
  learnedIntervalMs: number
): boolean {
  const effectiveWindow = Math.max(ruleWindowMs, 3 * learnedIntervalMs);
  const cutoff = now - effectiveWindow;
  // Samples are appended in time order, so a linear tail scan is enough.
  const win: TrendSample[] = [];
  for (const s of samples) if (s.t >= cutoff) win.push(s);
  if (win.length < TREND_MIN_SAMPLES) return false;
  const newest = win[win.length - 1];
  if (now - newest.t > 2 * learnedIntervalMs) return false; // series went stale
  for (let i = 1; i < win.length; i++) {
    if (win[i].v <= win[i - 1].v) return false;
  }
  return true;
}

const newestTime = (samples: readonly TrendSample[]): number =>
  samples.length > 0 ? samples[samples.length - 1].t : -1;

const isStale = (
  samples: readonly TrendSample[],
  now: number,
  learnedIntervalMs: number
): boolean => {
  const last = newestTime(samples);
  if (last < 0) return false;
  return now - last > 3 * learnedIntervalMs + STALE_EXTRA_MS;
};

/**
 * Applies downgrade hysteresis. Upgrades (and the first ever level) take effect
 * immediately; a downgrade is held at the current level until the lower raw
 * level has persisted for `holdMs`. Returns the next persisted state.
 */
export function applyHysteresis(
  prev: HealthChipState | undefined,
  raw: HealthLevel,
  now: number,
  holdMs: number
): HealthChipState {
  if (prev === undefined) {
    return { level: raw, since: now, pendingLevel: null, pendingSince: 0 };
  }
  if (RANK[raw] >= RANK[prev.level]) {
    // Same level or an upgrade: adopt at once and drop any pending downgrade.
    return {
      level: raw,
      since: raw === prev.level ? prev.since : now,
      pendingLevel: null,
      pendingSince: 0,
    };
  }
  // Downgrade candidate. Start (or continue) the hold clock for this raw level.
  if (prev.pendingLevel === raw) {
    if (now - prev.pendingSince >= holdMs) {
      return { level: raw, since: now, pendingLevel: null, pendingSince: 0 };
    }
    return prev; // still holding the higher level
  }
  return {
    level: prev.level,
    since: prev.since,
    pendingLevel: raw,
    pendingSince: now,
  };
}

/** ok/attention/problem chips share this hysteresis + stale + render wrapper. */
function stateChip(
  id: HealthChipId,
  label: string,
  raw: HealthLevel,
  qualifierFor: (level: HealthLevel) => string,
  metric: HealthMetric,
  prev: Map<HealthChipId, HealthChipState>,
  now: number,
  learnedIntervalMs: number,
  next: Map<HealthChipId, HealthChipState>
): HealthChip {
  const render = metric.samples.length >= MIN_RENDER_SAMPLES;
  if (!render) {
    // Not enough data yet: carry no state forward, render nothing.
    return {
      id,
      label,
      level: null,
      informational: false,
      qualifier: "",
      value: metric.value,
      detail: null,
      since: now,
      stale: false,
      render: false,
    };
  }
  const holdMs = Math.max(HYSTERESIS_MIN_MS, learnedIntervalMs);
  const state = applyHysteresis(prev.get(id), raw, now, holdMs);
  next.set(id, state);
  const stale = isStale(metric.samples, now, learnedIntervalMs);
  return {
    id,
    label,
    level: state.level,
    informational: false,
    // Silence drops the qualifier (and, in the view, the dot); ok has none.
    qualifier: stale || state.level === "ok" ? "" : qualifierFor(state.level),
    value: metric.value,
    detail: null,
    since: state.since,
    stale,
    render: true,
  };
}

/** heap/churn: a plain value, no dot, no hysteresis. */
function infoChip(
  id: HealthChipId,
  label: string,
  metric: HealthMetric,
  detail: number | null,
  now: number,
  learnedIntervalMs: number
): HealthChip {
  const render = metric.samples.length >= MIN_RENDER_SAMPLES;
  return {
    id,
    label,
    level: null,
    informational: true,
    qualifier: "",
    value: metric.value,
    detail,
    since: now,
    stale: render && isStale(metric.samples, now, learnedIntervalMs),
    render,
  };
}

/** The metric snapshots each chip needs, keyed by registry id. */
export interface HealthInputs {
  msgs_dropped: HealthMetric;
  msg_rate_in: HealthMetric;
  delivery_backlog: HealthMetric;
  heap_current: HealthMetric;
  heap_max: HealthMetric;
  store_msgs: HealthMetric;
  store_bytes: HealthMetric;
  sockets_1min: HealthMetric;
}

const empty = (m?: HealthMetric): HealthMetric => m ?? { value: null, samples: [] };

/** Rule windows (ms) from the health table. */
const DROPS_RISE_MS = 60_000;
const BACKLOG_ATTENTION_MS = 60_000;
const BACKLOG_PROBLEM_MS = 120_000;
const STORE_RISE_MS = 120_000;
/** Drops go red once they exceed this fraction of the inbound rate... */
const DROPS_RELATIVE_FRACTION = 0.05;
/** ...but never on a trickle of inbound traffic. */
const DROPS_MIN_INBOUND = 1;

/**
 * Evaluates every health chip. Returns the renderable chips plus the next
 * hysteresis-state map (which the store persists and passes back next tick).
 */
export function evaluateHealth(
  inputs: Partial<HealthInputs>,
  prev: Map<HealthChipId, HealthChipState>,
  now: number,
  learnedIntervalMs: number
): { chips: HealthChip[]; states: Map<HealthChipId, HealthChipState> } {
  const next = new Map<HealthChipId, HealthChipState>();

  const drops = empty(inputs.msgs_dropped);
  const inbound = empty(inputs.msg_rate_in);
  const backlog = empty(inputs.delivery_backlog);
  const heapCur = empty(inputs.heap_current);
  const heapMax = empty(inputs.heap_max);
  const storeMsgs = empty(inputs.store_msgs);
  const storeBytes = empty(inputs.store_bytes);
  const sockets = empty(inputs.sockets_1min);

  // --- Drops -----------------------------------------------------------------
  const dropRate = drops.value ?? 0;
  const dropsRising = isRising(drops.samples, now, DROPS_RISE_MS, learnedIntervalMs);
  const inboundRate = inbound.value;
  const dropsRelativeHigh =
    inboundRate !== null &&
    inboundRate >= DROPS_MIN_INBOUND &&
    dropRate > DROPS_RELATIVE_FRACTION * inboundRate;
  let dropsRaw: HealthLevel;
  if (dropRate <= 0) dropsRaw = "ok";
  else if (dropsRising || dropsRelativeHigh) dropsRaw = "problem";
  else dropsRaw = "attention";
  const dropsChip = stateChip(
    "drops",
    "Drops",
    dropsRaw,
    (lvl) => (lvl === "problem" ? "rising" : "present"),
    drops,
    prev,
    now,
    learnedIntervalMs,
    next
  );

  // --- Delivery backlog ------------------------------------------------------
  // A longer sustained rise is worse: test the 120 s window first.
  const backlogProblem = isRising(backlog.samples, now, BACKLOG_PROBLEM_MS, learnedIntervalMs);
  const backlogAttention = isRising(backlog.samples, now, BACKLOG_ATTENTION_MS, learnedIntervalMs);
  const backlogRaw: HealthLevel = backlogProblem
    ? "problem"
    : backlogAttention
      ? "attention"
      : "ok";
  const backlogChip = stateChip(
    "backlog",
    "Delivery backlog",
    backlogRaw,
    () => "rising",
    backlog,
    prev,
    now,
    learnedIntervalMs,
    next
  );

  // --- Store (never red) -----------------------------------------------------
  const storeRising =
    isRising(storeMsgs.samples, now, STORE_RISE_MS, learnedIntervalMs) ||
    isRising(storeBytes.samples, now, STORE_RISE_MS, learnedIntervalMs);
  // Drive rendering off whichever series has the deeper trail.
  const storeMetric: HealthMetric =
    storeMsgs.samples.length >= storeBytes.samples.length ? storeMsgs : storeBytes;
  const storeChip = stateChip(
    "store",
    "Store",
    storeRising ? "attention" : "ok",
    () => "rising",
    storeMetric,
    prev,
    now,
    learnedIntervalMs,
    next
  );

  // --- Heap (informational, never colours) -----------------------------------
  const heapChip = infoChip(
    "heap",
    "Heap",
    heapCur,
    heapMax.value,
    now,
    learnedIntervalMs
  );

  // --- Churn (informational) -------------------------------------------------
  const churnChip = infoChip(
    "churn",
    "Churn",
    sockets,
    null,
    now,
    learnedIntervalMs
  );

  return {
    chips: [dropsChip, backlogChip, storeChip, heapChip, churnChip],
    states: next,
  };
}
