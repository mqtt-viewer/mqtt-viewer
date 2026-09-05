// Frame pacing for the Topic Graph renderer. Kept free of Pixi so the cadence
// can be unit-tested against simulated display rates without a ticker.
//
// The renderer does not use Pixi's ticker.maxFPS cap. Ticker.update truncates
// the gap since the last rendered frame to whole milliseconds before comparing
// it with 1000/maxFPS, so a 60 fps cap on a 120 Hz display settles into a
// run-skip-skip / run-skip pattern (17, 25 and 8 ms gaps between rendered
// frames) instead of rendering every second tick, and on a 60 Hz display it
// drops the odd frame outright (16 < 16.667). The ticker runs uncapped and the
// renderer asks a FramePacer on every rAF tick whether to draw.

export function targetIntervalMs(fps: number): number {
  return 1000 / fps;
}

// Number of recent rAF gaps kept for the display-interval estimate. 30 ticks
// is a quarter of a second at 120 Hz: short enough to follow a window dragged
// to a display with a different refresh rate, long enough that timestamp
// noise averages out (see displayGap).
const RING_SIZE = 30;

// Gaps outside this window are not evidence of the display rate: below it two
// callbacks landed in one frame or the ticker was stopped and restarted, above
// it the tab stalled.
const MIN_GAP_MS = 2;
const MAX_GAP_MS = 250;

// Fraction of the estimated display interval above which a rAF gap is treated
// as a missed vsync and left out of the mean. A dropped vsync doubles the gap,
// so anything past 1.5 intervals is one, while timestamp noise stays well
// inside (a millisecond on a 4 ms interval at 240 Hz is 1.25 intervals).
const DROPPED_VSYNC_FACTOR = 1.5;

// Where the stride boundary sits between whole multiples of the display
// interval. Half would pick the cadence closest to the target, but 90 Hz with
// a 60 fps target is exactly 1.5 display intervals per target interval, so a
// boundary at a half flips the stride on the last bit of the estimate. 0.47
// leans the tie toward the slower cadence (the target is a ceiling on work,
// not an exact rate) and leaves the two awkward displays comparable margins:
// 90 Hz can be estimated 0.23 ms fast and 144 Hz (2.4 intervals) 0.2 ms slow
// before the stride changes, against an estimate that is good to 1/30 ms.
const STRIDE_BOUNDARY = 0.47;

// Decides per rAF tick whether to draw by counting ticks rather than measuring
// time. A time comparison against the target interval is jitter-sensitive
// whenever the display rate is not a whole multiple of the target: at 90 Hz
// the second tick sits 0.5 ms from the boundary, at 144 Hz 0.35 ms, and
// WebKit (WebKitGTK on Linux, WKWebView on macOS) rounds rAF timestamps to
// whole milliseconds, so such a gate alternated between strides and produced
// the uneven cadence it was meant to remove. Here the stride (render every
// Nth tick) is derived from an estimate of the display interval that averages
// the noise away, and the per-tick decision is a count, which quantised
// timestamps cannot disturb.
//
// Resulting cadences with a 60 fps target: 60 Hz stride 1, 90 Hz stride 2
// (45 fps, even regardless of jitter), 120 Hz stride 2, 144 Hz stride 2
// (72 fps: the target is a ceiling on work rather than an exact rate, and
// every second tick is the closest even cadence), 165 Hz stride 3, 240 Hz
// stride 4. Displays between 60 and about 88 Hz round to stride 1 and so
// render at their own rate (75 Hz gives 75 fps): the target caps how often
// the graph draws on fast panels, it is not an exact rate. A 30 fps target
// doubles each stride (144 Hz becomes 5, the closest whole number to 4.8).
export class FramePacer {
  // ring of the last RING_SIZE usable rAF gaps, in no particular order
  private recentGaps: number[] = [];
  private ringIndex = 0;
  private ticksSinceRender = 0;
  // ticker-clock time of the last tick that rendered; -Infinity so the very
  // first tick always draws
  private lastRenderAt = -Infinity;

  shouldRender(nowMs: number, rafGapMs: number, targetIntervalMs: number): boolean {
    if (rafGapMs > MIN_GAP_MS && rafGapMs < MAX_GAP_MS) this.record(rafGapMs);
    // Before the first usable gap arrives there is nothing to estimate from;
    // one tick per target interval is the neutral assumption.
    const displayGap = this.recentGaps.length === 0 ? targetIntervalMs : this.displayGap();
    const stride = Math.max(
      1,
      Math.floor(targetIntervalMs / displayGap + (1 - STRIDE_BOUNDARY))
    );
    this.ticksSinceRender += 1;
    const render =
      this.lastRenderAt === -Infinity ||
      this.ticksSinceRender >= stride ||
      // Recovers promptly when the browser dropped a vsync: the tick after
      // the drop is already past the target interval, so it draws rather
      // than waiting out the rest of the stride. The quarter-interval slack
      // stops timestamp noise from tripping it on a normal tick; the stride
      // rule never lets a normal cadence get within that slack. A stall
      // satisfies it too, so the first tick after one draws.
      nowMs - this.lastRenderAt >= targetIntervalMs - displayGap / 4;
    if (render) {
      this.ticksSinceRender = 0;
      this.lastRenderAt = nowMs;
    }
    return render;
  }

  private record(gapMs: number): void {
    if (this.recentGaps.length < RING_SIZE) {
      this.recentGaps.push(gapMs);
    } else {
      this.recentGaps[this.ringIndex] = gapMs;
      this.ringIndex = (this.ringIndex + 1) % RING_SIZE;
    }
  }

  // Estimate of the display's refresh interval: the mean of the ring with
  // missed vsyncs left out. The mean of consecutive gaps telescopes to the
  // span between the first and last tick divided by the count, so timestamp
  // jitter and millisecond rounding contribute at most 1/RING_SIZE ms, which
  // is what makes the 144 Hz and 90 Hz strides stable (see STRIDE_BOUNDARY).
  // The minimum or median alone would not do: a dropped vsync only ever makes
  // a gap longer, so the minimum is robust to drops, but WebKit's rounding
  // turns 6.94 ms at 144 Hz into runs of 7 with an occasional 6, and a
  // minimum of 6 reads as stride 3. Drops are instead recognised relative to
  // the median, which noise of a millisecond cannot move far, and excluded
  // from the mean.
  private displayGap(): number {
    const n = this.recentGaps.length;
    const sorted = this.recentGaps.slice().sort((a, b) => a - b);
    const cutoff = sorted[(n - 1) >> 1] * DROPPED_VSYNC_FACTOR;
    let sum = 0;
    let count = 0;
    for (const g of this.recentGaps) {
      if (g <= cutoff) {
        sum += g;
        count += 1;
      }
    }
    return sum / count;
  }
}
