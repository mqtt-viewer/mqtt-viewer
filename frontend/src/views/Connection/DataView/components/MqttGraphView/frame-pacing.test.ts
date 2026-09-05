import { expect, test } from "vitest";
import { FramePacer, targetIntervalMs } from "./frame-pacing";

// Feed tick timestamps through a fresh pacer exactly the way onTick does: the
// gap passed with each tick is the difference from the previous tick's
// timestamp (zero for the first). Returns which ticks rendered alongside the
// timestamps so cadence and gaps can be checked over any window.
function simulate(tickTimes: number[], targetFps: number) {
  const pacer = new FramePacer();
  const interval = targetIntervalMs(targetFps);
  let prev = tickTimes[0];
  const rendered: boolean[] = [];
  for (const now of tickTimes) {
    const gap = now - prev;
    prev = now;
    rendered.push(pacer.shouldRender(now, gap, interval));
  }
  return { tickTimes, rendered };
}

type Sim = ReturnType<typeof simulate>;

// The ring needs a few ticks before its estimate of the display interval is
// accurate, so cadence assertions start once it has filled.
const SETTLE = 30;

// From the first render at or after tick `from`, every nth tick renders and
// no other does.
function expectStride(sim: Sim, n: number, from = SETTLE) {
  const first = sim.rendered.findIndex((r, i) => i >= from && r);
  expect(first).toBeGreaterThanOrEqual(from);
  for (let i = first; i < sim.rendered.length; i++) {
    expect(sim.rendered[i], `tick ${i}`).toBe((i - first) % n === 0);
  }
}

function renderGapsFrom(sim: Sim, from = SETTLE): number[] {
  const times = sim.tickTimes.filter((_, i) => i >= from && sim.rendered[i]);
  expect(times.length).toBeGreaterThan(2);
  return times.slice(1).map((t, i) => t - times[i]);
}

// consecutive render gaps differ by less than toleranceMs
function expectEvenGaps(gaps: number[], toleranceMs = 1.5) {
  for (let i = 1; i < gaps.length; i++) {
    expect(Math.abs(gaps[i] - gaps[i - 1]), `gap ${i}`).toBeLessThan(toleranceMs);
  }
}

// every render gap sits within toleranceMs of the nominal one
function expectGapsNear(gaps: number[], nominalMs: number, toleranceMs: number) {
  for (const g of gaps) expect(Math.abs(g - nominalMs)).toBeLessThanOrEqual(toleranceMs);
}

function evenTicks(count: number, periodMs: number, start = 1000): number[] {
  return Array.from({ length: count }, (_, i) => start + i * periodMs);
}

// deterministic per-tick timestamp jitter in [-1, 1], scaled by amplitude
const JITTER = [1, -1, 0.4, -0.8, 0, 0.9, -0.2, -1, 0.6, -0.5];
function jitteredTicks(count: number, periodMs: number, amplitudeMs: number): number[] {
  return evenTicks(count, periodMs).map((t, i) => t + JITTER[i % JITTER.length] * amplitudeMs);
}

// WebKit hands rAF whole-millisecond timestamps: rounding the true ones
// reproduces its gap patterns (16/17 at 60 Hz, 8/8/9 at 120 Hz, 11 with a 12
// every ninth tick at 90 Hz, 7 with a 6 every eighteenth at 144 Hz).
function quantisedTicks(count: number, periodMs: number): number[] {
  return evenTicks(count, periodMs).map((t) => Math.round(t));
}

const period = (hz: number) => 1000 / hz;

test.each([
  [60, 1],
  [120, 2],
  [144, 2],
  [165, 3],
  [240, 4],
])("%i Hz display, 60 fps target: renders every %i ticks with even gaps", (hz, stride) => {
  const sim = simulate(evenTicks(300, period(hz)), 60);
  expectStride(sim, stride);
  const gaps = renderGapsFrom(sim);
  expectEvenGaps(gaps);
  expectGapsNear(gaps, stride * period(hz), 1e-6);
});

test.each([
  [60, 2],
  [120, 4],
  [144, 5],
])("%i Hz display, 30 fps target: renders every %i ticks with even gaps", (hz, stride) => {
  const sim = simulate(evenTicks(300, period(hz)), 30);
  expectStride(sim, stride);
  const gaps = renderGapsFrom(sim);
  expectEvenGaps(gaps);
  expectGapsNear(gaps, stride * period(hz), 1e-6);
});

// 90 Hz is the awkward case: two ticks per target interval would be 45 fps,
// one tick 90 fps, and the boundary sits exactly between them. The stride
// must settle on 2 and stay there whatever the timestamps do.
test("90 Hz display with 0.5 ms jitter, 60 fps target: renders every second tick", () => {
  const sim = simulate(jitteredTicks(600, period(90), 0.5), 60);
  expectStride(sim, 2);
  // each render gap is two periods give or take the jitter of its two ends
  expectGapsNear(renderGapsFrom(sim), 2 * period(90), 1);
});

test("144 Hz display with 0.5 ms jitter, 60 fps target: renders every second tick", () => {
  const sim = simulate(jitteredTicks(600, period(144), 0.5), 60);
  expectStride(sim, 2);
  expectGapsNear(renderGapsFrom(sim), 2 * period(144), 1);
});

test.each([
  [60, 1],
  [90, 2],
  [120, 2],
  [144, 2],
])(
  "%i Hz display with millisecond timestamps, 60 fps target: renders every %i ticks",
  (hz, stride) => {
    const sim = simulate(quantisedTicks(600, period(hz)), 60);
    expectStride(sim, stride);
    // rounding moves each render by at most a millisecond
    expectEvenGaps(renderGapsFrom(sim));
  }
);

test("dropped vsync at 120 Hz: renders on the late tick, then the cadence resumes", () => {
  const P = period(120);
  // tick 98 renders (even), then tick 99 arrives a whole period late
  const ticks = evenTicks(99, P);
  const late = ticks[98] + 2 * P;
  for (let i = 0; i < 60; i++) ticks.push(late + i * P);
  const sim = simulate(ticks, 60);
  expect(sim.rendered[98]).toBe(true);
  expect(sim.rendered[99], "the late tick draws").toBe(true);
  expect(sim.rendered[100], "not the one after it").toBe(false);
  expectStride(sim, 2, 99);
  expectGapsNear(renderGapsFrom(sim), 2 * P, 1e-6);
});

test("stall: renders on the first tick after it and keeps the display estimate", () => {
  const P = period(120);
  const ticks = evenTicks(100, P);
  const resume = ticks[99] + 500;
  for (let i = 0; i < 60; i++) ticks.push(resume + i * P);
  const sim = simulate(ticks, 60);
  expect(sim.rendered[100], "first tick after the stall").toBe(true);
  // still stride 2 straight away: the 500 ms gap never entered the ring
  expectStride(sim, 2, 100);
  expectGapsNear(renderGapsFrom(sim, 100), 2 * P, 1e-6);
});

test("first tick renders", () => {
  expect(new FramePacer().shouldRender(0, 0, targetIntervalMs(60))).toBe(true);
  expect(new FramePacer().shouldRender(1000, period(120), targetIntervalMs(60))).toBe(true);
  expect(simulate([1000], 30).rendered).toEqual([true]);
});

test("ticker restart (a gap under 2 ms) does not change the stride", () => {
  const P = period(120);
  const ticks = evenTicks(100, P);
  const restart = ticks[99] + 0.5;
  for (let i = 0; i < 60; i++) ticks.push(restart + i * P);
  const sim = simulate(ticks, 60);
  expectStride(sim, 2, 101);
  expectGapsNear(renderGapsFrom(sim, 101), 2 * P, 1e-6);
});
