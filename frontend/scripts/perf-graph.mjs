#!/usr/bin/env node
// Topic Graph performance regression check.
//
// Boots the dev harness (frontend/dev/topic-graph.html) against a synthetic
// ?scale=30 tree (~2400 placed nodes, matching the baseline in
// frontend/perf-baseline.json), expands every node, waits for the layout to
// settle, then samples the harness's window.__perf meter five times and
// compares the average frame time against the committed baseline.
//
// Usage:
//   node scripts/perf-graph.mjs          (from frontend/)
//   pnpm perf:graph
//
// Env:
//   PERF_PORT   port for the throwaway vite dev server (default: pick a free
//               one; do not assume 5180/5173 are free, another vite instance
//               may already be running for local dev)
//
// IMPORTANT: headless vs headed caveat.
// Headless Chromium renders WebGL/Canvas2D through software GL (SwiftShader
// or similar) on most CI runners and many dev machines without a GPU passed
// through. That makes headless frame times NOT COMPARABLE to a real browser
// session: a headless run can be several times slower than headed for
// identical work. This script therefore:
//   1. Tries to launch HEADED first (headless: false).
//   2. Falls back to headless with a printed warning if headed launch fails
//      (e.g. no display server / CI runner with no Xvfb).
//   3. Compares against whichever baseline field matches the mode actually
//      used (headedAvgFrameMs vs headlessAvgFrameMs in perf-baseline.json).
//      Never cross-compare a headless run against the headed baseline or
//      vice versa.
//
// Exit codes:
//   0  pass, or WARN (soft regression: avgFrameMs above baseline but within
//      the 3x hard threshold)
//   1  hard regression: avgFrameMs > 3x the matching baseline field

import { createServer } from "vite";
import { chromium } from "playwright";
import { createServer as createNetServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const baselinePath = path.join(frontendRoot, "perf-baseline.json");

const HARD_REGRESSION_MULTIPLIER = 3;
const SETTLE_TIMEOUT_MS = 30000;
const SAMPLE_COUNT = 5;
const SAMPLE_INTERVAL_MS = 1100; // > the harness's 1s __perf refresh window

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function launchBrowser() {
  // PERF_HEADLESS=1 forces headless (compared against headlessAvgFrameMs):
  // used to calibrate that baseline field locally and by CI runners that
  // have no display server.
  if (process.env.PERF_HEADLESS === "1") {
    const browser = await chromium.launch({ headless: true });
    return { browser, headed: false };
  }
  try {
    const browser = await chromium.launch({ headless: false });
    return { browser, headed: true };
  } catch (err) {
    console.warn(
      `[perf-graph] WARN: headed Chromium launch failed (${err.message}); ` +
        `falling back to headless. Headless frame times use software GL and ` +
        `are NOT comparable to headed/real-browser numbers. This run will ` +
        `be checked against the headlessAvgFrameMs baseline field instead.`
    );
    const browser = await chromium.launch({ headless: true });
    return { browser, headed: false };
  }
}

async function main() {
  const port = Number(process.env.PERF_PORT) || (await findFreePort());

  console.log(`[perf-graph] starting vite dev server on 127.0.0.1:${port}...`);
  const vite = await createServer({
    root: frontendRoot,
    server: { host: "127.0.0.1", port, strictPort: true },
    logLevel: "warn",
  });
  await vite.listen();

  const { browser, headed } = await launchBrowser();
  console.log(`[perf-graph] launched Chromium (${headed ? "headed" : "headless"})`);

  let exitCode = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const url = `http://127.0.0.1:${port}/dev/topic-graph.html?scale=30`;
    console.log(`[perf-graph] opening ${url}`);
    await page.goto(url, { waitUntil: "load" });

    // The harness's main() is async (awaits renderer.init() before binding
    // the toolbar's click listeners), so clicking #d9 immediately after
    // waitForSelector is a real race: the element exists in the DOM well
    // before its listener is attached. Wait for window.__r (set at the very
    // end of that init, right before listeners are bound) so the click lands.
    await page.waitForFunction(() => !!window.__r && !!window.__m, {
      timeout: SETTLE_TIMEOUT_MS,
    });

    // IMPORTANT: main() itself schedules a one-shot `renderer.expandToDepth(1)`
    // ~600ms after init (see frontend/dev/topic-graph-dev.ts) to settle the
    // harness's initial view. Expanding before that fires gets silently
    // stomped back to depth 1. Wait it out before touching expand state.
    await page.waitForTimeout(900);

    await page.waitForSelector("#d9", { timeout: SETTLE_TIMEOUT_MS });
    await page.click("#d9");

    // wait for the tree to settle: topic count stops climbing and
    // window.__perf has published at least once
    await page.waitForFunction(
      () => {
        const w = window;
        return !!w.__perf && !!w.__m && w.__m.topicCount > 0;
      },
      { timeout: SETTLE_TIMEOUT_MS }
    );

    // Confirm expand-all actually took effect (placedNodes should climb well
    // past the depth-1 default of a couple hundred). If the click still
    // didn't land for some reason (or landed before the 600ms auto-collapse
    // above, in a differently-timed environment), fall back to calling the
    // renderer API directly rather than silently reporting a misleadingly
    // tiny tree.
    await page.waitForTimeout(1000);
    const placedAfterClick = await page.evaluate(() => window.__r.getPerfCounts().placedNodes);
    if (placedAfterClick < 500) {
      console.warn(
        "[perf-graph] WARN: #d9 click didn't appear to expand the tree " +
          `(placedNodes=${placedAfterClick}); calling expandToDepth(99) directly.`
      );
      await page.evaluate(() => window.__r.expandToDepth(99));
    }

    // Give the mock traffic generator time to actually create most of its
    // topic pool (each topic's first appearance is a random per-tick chance
    // proportional to its rate, so low-rate topics can take many seconds to
    // show up even after expand-all) and let layout/easing settle. This
    // doesn't reach every last low-rate topic (the tail can take a minute+),
    // but gets comfortably past the ~2400-node baseline reference size.
    await page.waitForTimeout(20000);

    const samples = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      await page.waitForTimeout(SAMPLE_INTERVAL_MS);
      const snapshot = await page.evaluate(() => window.__perf ?? null);
      if (snapshot) samples.push(snapshot);
    }

    if (samples.length === 0) {
      console.error("[perf-graph] FAIL: never observed a window.__perf sample");
      exitCode = 1;
    } else {
      const avg = (key) => samples.reduce((s, x) => s + x[key], 0) / samples.length;
      const report = {
        mode: headed ? "headed" : "headless",
        fps: Math.round(avg("fps") * 10) / 10,
        avgFrameMs: Math.round(avg("avgFrameMs") * 100) / 100,
        worstFrameMs: Math.round(Math.max(...samples.map((s) => s.worstFrameMs)) * 100) / 100,
        placedNodes: samples[samples.length - 1].placedNodes,
        visibleNodes: samples[samples.length - 1].visibleNodes,
        samples,
      };
      console.log(JSON.stringify(report, null, 2));

      const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
      const baselineKey = headed ? "headedAvgFrameMs" : "headlessAvgFrameMs";
      const baselineMs = baseline[baselineKey];

      if (typeof baselineMs !== "number") {
        console.warn(
          `[perf-graph] WARN: no ${baselineKey} in perf-baseline.json, skipping comparison.`
        );
      } else {
        const ratio = report.avgFrameMs / baselineMs;
        const hardLimit = baselineMs * HARD_REGRESSION_MULTIPLIER;
        console.log(
          `[perf-graph] avgFrameMs ${report.avgFrameMs}ms vs ${baselineKey} ${baselineMs}ms ` +
            `(${ratio.toFixed(2)}x, hard limit ${hardLimit.toFixed(2)}ms)`
        );
        if (report.avgFrameMs > hardLimit) {
          console.error(
            `[perf-graph] FAIL: avgFrameMs exceeds ${HARD_REGRESSION_MULTIPLIER}x the ${baselineKey} baseline.`
          );
          exitCode = 1;
        } else if (report.avgFrameMs > baselineMs) {
          console.warn(
            `[perf-graph] WARN: avgFrameMs regressed vs baseline but within the ${HARD_REGRESSION_MULTIPLIER}x tolerance (CI GPUs vary; this is a soft warning, not a failure).`
          );
        } else {
          console.log("[perf-graph] PASS: within baseline.");
        }
      }
    }
  } finally {
    await browser.close();
    await vite.close();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[perf-graph] FAIL:", err);
  process.exit(1);
});
