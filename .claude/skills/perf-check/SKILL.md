---
name: perf-check
description: Verify MQTT Viewer stays smooth under heavy broker load using the local flood harness. Use before merging changes to message handling, the topic tree, history, or the graph view, or when the user says "check performance", "run the flood test", or reports the app lagging on busy brokers.
---

# Performance check under broker load

## The bar

Two brokers, each flooded at around 2000 msg/s across a wide topic tree,
with the app connected to both. The UI must stay responsive: topic tree
updates, panel interactions, and the graph view must not stutter or leak
memory over several minutes. This reproduces what heavy public brokers
like test.mosquitto.org do to the app.

## Setup (one-time)

```sh
# local brokers (macOS)
brew install mosquitto

# python env for the harness
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install paho-mqtt
```

`scripts/.venv` is gitignored, so it does not exist in an agent
worktree. Either re-run those two lines there, or use the main
checkout's copy at `~/git/mqtt-viewer/scripts/.venv/bin/python3`.
Backgrounding the flood before checking the interpreter exists fails
silently and looks like a broker with no traffic.

## Run

Terminals 1 and 2, one broker each:

```sh
mosquitto -p 1883
mosquitto -p 1884
```

Ports 1883/1884 are often taken on this machine (OrbStack binds 1883,
other sessions leave mosquitto on 1884). Check with
`lsof -i :1883 -i :1884` and fall back to 11883/11884; the flood script
and the app both accept any port. When running the flood scripts in the
background, note their stdout is block-buffered (no tty), so verify
throughput with `timeout 3 mosquitto_sub -p <port> -t '#' | wc -l`
instead of reading their output.

Terminals 3 and 4, one flood each (each prints achieved msg/s once per
second; confirm it holds the target rate):

```sh
scripts/.venv/bin/python scripts/mqtt-flood.py --port 1883 --rate 2000
scripts/.venv/bin/python scripts/mqtt-flood.py --port 1884 --rate 2000
```

Then run the app (`just dev`), connect to both brokers
(localhost:1883 and localhost:1884), and exercise it for at least a few
minutes.

`scripts/mqtt-sim.py` is the companion script for realistic varied
cadences rather than sustained flood; use it when debugging behavior
rather than throughput.

## What to watch

- Topic tree and message counters keep updating without multi-second
  freezes.
- Selecting topics and opening the right panel stays instant.
- The graph view (if the change touches it) holds an acceptable frame
  rate; it has culling/LOD/adaptive-fps logic that should degrade
  gracefully rather than freeze.
- Memory: watch the process in Activity Monitor for unbounded growth
  over 5+ minutes.
- CPU settles rather than climbing after you disconnect the floods.

Report concrete observations (achieved msg/s, where it stuttered, memory
trend), not just "seems fine".

## Reading memory correctly

Two things make RSS misleading, so judge growth only while the floods
are still running:

- macOS compresses an idle process's pages. Once the floods stop, RSS
  collapses (a run holding ~600 MB read as 34 MB) and tells you nothing.
- In-RAM history is capped by `DefaultMemoryBudgetBytes`, 512 MB per
  connection, so two connections climb toward ~1 GB of retained messages
  by design. With Go's default GOGC the process sits well above that.
  Rising toward the budget is the eviction working, not a leak. What
  would be a leak is growth that keeps going after the budget is full.

## Benchmarking the message path

If the change is to ingest itself, a Go benchmark pins it down faster
than watching the UI. Two traps:

- `receiveMessage` debug-logs every message. That logging is off in
  production builds (`backend/app/startup.go`), but on in tests, where
  it costs roughly as much as the work itself: ingest measures ~700-800
  ns per message with it off, ~1200 ns with it formatting to a discard
  handler, and ~4000 ns writing to the console handler. Swap in a
  discard handler with `slog.SetDefault` for the benchmark, or you are
  timing the logger.
- Work handed to another goroutine does not get counted. Measure to
  completion: spin until the messages have actually landed in history
  before `b.StopTimer()`, otherwise deferring work looks like a speedup.
  `runtime.NumGoroutine()` sampled during the run is worth reporting
  too, since a backlog shows up there first.

## Driving the app headlessly

`scripts/serve-browser.sh` runs the real backend and is drivable from
the browser pane, which is usually easier than the native window. Two
things to know: live message events need
`<script src="/wails/custom.js"></script>` injected into the page (see
`AGENTS.md`), and the process can panic on shutdown with `server
shutdown error: context deadline exceeded`, seemingly when a client goes
away with that WebSocket open. It is a dev-only path, but it will end a
run mid-measurement, so take readings as you go rather than only at the
end.
