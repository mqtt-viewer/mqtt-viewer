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

## Run

Terminals 1 and 2, one broker each:

```sh
mosquitto -p 1883
mosquitto -p 1884
```

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
