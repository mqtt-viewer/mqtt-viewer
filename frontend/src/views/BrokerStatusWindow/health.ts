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
//     republishers like mosquitto only re-emit changed values, so silence is a
//     held value, never a gap and never staleness — see below);
//   - a chip renders nothing until it has a sample (cumulative sources only
//     produce their first, rate, sample after two raw counter readings);
//   - `trendFloorMs` excludes samples from before a reconnect, so a restarted
//     broker refilling its retained store never reads as "rising".
//
// Staleness is a property of the $SYS feed, never of one metric. A chip greys
// out only when the broker has stopped publishing $SYS altogether, that is when
// the newest $SYS message on any topic (`sysLastSeenMs`) is older than
// 3 × learnedInterval + 30 s. One quiet metric means nothing: change-only
// republishers like mosquitto never re-emit a value that has not moved, so a
// broker with no drops leaves `.../publish/messages/dropped` at 0 forever.
// Reading that silence as staleness greyed out healthy chips and stripped the
// qualifier off a genuinely amber one, so no rule may derive staleness from a
// single metric's own sample age. With no $SYS seen at all (`sysLastSeenMs`
// ≤ 0) nothing is stale; the render gate already hides those chips.
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

/**
 * Minimum samples before a chip renders. One suffices: gauge sources are
 * meaningful from their first (often retained) value, and change-only
 * republishers like mosquitto never re-emit a permanently-zero gauge, so a
 * two-sample gate would hide the drops/backlog chips on a healthy broker
 * forever. Cumulative sources stay protected implicitly — the store only
 * emits their first sample once a rate exists (two raw counter readings), so
 * a single EMQX counter snapshot still renders nothing.
 */
export const MIN_RENDER_SAMPLES = 1;
/** A trend clause needs at least this many in-window samples to be considered. */
export const TREND_MIN_SAMPLES = 3;
/** Hysteresis floor; the effective hold is max(this, learnedInterval). */
export const HYSTERESIS_MIN_MS = 30_000;
/** Chips grey out once the whole $SYS feed has been silent this long. */
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
  learnedIntervalMs: number,
  trendFloorMs = 0
): boolean {
  const effectiveWindow = Math.max(ruleWindowMs, 3 * learnedIntervalMs);
  // The floor excludes samples from before a reconnect (and, while it sits in
  // the future, every sample) so a restarted broker's retained-store
  // repopulation is not read as a rising trend.
  const cutoff = Math.max(now - effectiveWindow, trendFloorMs);
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

/**
 * Feed-level staleness: true once the broker has stopped publishing $SYS
 * entirely. `sysLastSeenMs` is the newest $SYS message time across every topic,
 * so a metric that simply never changes (and is therefore never republished)
 * cannot make a chip stale on its own. A non-positive value means no $SYS has
 * been seen yet, which is not staleness.
 */
export const isFeedStale = (
  sysLastSeenMs: number,
  now: number,
  learnedIntervalMs: number
): boolean => {
  if (sysLastSeenMs <= 0) return false;
  return now - sysLastSeenMs > 3 * learnedIntervalMs + STALE_EXTRA_MS;
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
  stale: boolean,
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
  stale: boolean
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
    stale: render && stale,
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
 * Below one drop a minute the chip stays green. mosquitto's
 * `load/publish/dropped/1min` is a decaying moving average that lingers above
 * zero for minutes after a single drop, so "any non-zero rate" made an idle
 * broker read "Drops <0.1/s present" the moment the window opened.
 */
const DROPS_ATTENTION_MIN_RATE = 1 / 60;

/**
 * Evaluates every health chip. Returns the renderable chips plus the next
 * hysteresis-state map (which the store persists and passes back next tick).
 */
export function evaluateHealth(
  inputs: Partial<HealthInputs>,
  prev: Map<HealthChipId, HealthChipState>,
  now: number,
  learnedIntervalMs: number,
  trendFloorMs = 0,
  sysLastSeenMs = -1
): { chips: HealthChip[]; states: Map<HealthChipId, HealthChipState> } {
  const next = new Map<HealthChipId, HealthChipState>();
  // One verdict for every chip: the feed is quiet, or it is not.
  const stale = isFeedStale(sysLastSeenMs, now, learnedIntervalMs);
  const rising = (samples: readonly TrendSample[], ruleWindowMs: number) =>
    isRising(samples, now, ruleWindowMs, learnedIntervalMs, trendFloorMs);

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
  const dropsRising = rising(drops.samples, DROPS_RISE_MS);
  const inboundRate = inbound.value;
  const dropsRelativeHigh =
    inboundRate !== null &&
    inboundRate >= DROPS_MIN_INBOUND &&
    dropRate > DROPS_RELATIVE_FRACTION * inboundRate;
  let dropsRaw: HealthLevel;
  if (dropRate < DROPS_ATTENTION_MIN_RATE) dropsRaw = "ok";
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
    stale,
    next
  );

  // --- Delivery backlog ------------------------------------------------------
  // A longer sustained rise is worse: test the 120 s window first.
  const backlogProblem = rising(backlog.samples, BACKLOG_PROBLEM_MS);
  const backlogAttention = rising(backlog.samples, BACKLOG_ATTENTION_MS);
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
    stale,
    next
  );

  // --- Store (never red) -----------------------------------------------------
  const storeRising =
    rising(storeMsgs.samples, STORE_RISE_MS) ||
    rising(storeBytes.samples, STORE_RISE_MS);
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
    stale,
    next
  );

  // --- Heap (informational, never colours) -----------------------------------
  const heapChip = infoChip(
    "heap",
    "Heap",
    heapCur,
    heapMax.value,
    now,
    stale
  );

  // --- Churn (informational) -------------------------------------------------
  const churnChip = infoChip(
    "churn",
    "Churn",
    sockets,
    null,
    now,
    stale
  );

  return {
    chips: [dropsChip, backlogChip, storeChip, heapChip, churnChip],
    states: next,
  };
}
