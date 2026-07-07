#!/usr/bin/env python3
"""
High-rate MQTT flood publisher for MQTT Viewer performance testing.

Unlike mqtt-sim.py (realistic varied cadences), this pushes a sustained,
configurable message rate across a wide topic tree to reproduce heavy-load
brokers like test.mosquitto.org locally.

Usage:
    scripts/.venv/bin/python scripts/mqtt-flood.py --port 1883 --rate 2000 --topics 2000
    # Two-broker goal test (run in two terminals):
    scripts/.venv/bin/python scripts/mqtt-flood.py --port 1883 --rate 2000
    scripts/.venv/bin/python scripts/mqtt-flood.py --port 1884 --rate 2000

Ctrl-C to stop. Prints achieved msg/s once per second.
"""
import argparse
import json
import random
import sys
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit("paho-mqtt not installed. Run: scripts/.venv/bin/pip install paho-mqtt")


def build_topics(count):
    # Wide + deep tree, similar shape to a busy public broker: many devices
    # under a few roots, metrics as leaves.
    roots = ["plant", "fleet", "grid", "telemetry", "devices"]
    metrics = ["temperature", "voltage", "rpm", "status", "position", "signal"]
    topics = []
    i = 0
    while len(topics) < count:
        root = roots[i % len(roots)]
        group = i % max(1, count // 40)
        device = i % max(1, count // len(metrics))
        metric = metrics[i % len(metrics)]
        topics.append(f"{root}/group-{group:03d}/device-{device:04d}/{metric}")
        i += 1
    return topics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--rate", type=int, default=2000, help="target messages/second")
    ap.add_argument("--topics", type=int, default=2000, help="distinct topic count")
    ap.add_argument("--payload-bytes", type=int, default=120)
    ap.add_argument("--duration", type=float, default=0, help="seconds to run (0 = forever)")
    args = ap.parse_args()

    topics = build_topics(args.topics)
    pad = "x" * max(0, args.payload_bytes - 60)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"flood-{args.port}")
    client.connect(args.host, args.port)
    client.loop_start()

    print(f"Flooding {args.host}:{args.port} at target {args.rate} msg/s over {len(topics)} topics. Ctrl-C to stop.")

    start = time.time()
    sent = 0
    last_report = start
    reported_sent = 0
    # Send in small slices so we hold the target rate without busy-looping.
    slice_s = 0.02
    per_slice = max(1, int(args.rate * slice_s))
    try:
        while True:
            t = time.time()
            if args.duration and t - start > args.duration:
                break
            for _ in range(per_slice):
                topic = topics[sent % len(topics)]
                payload = json.dumps({
                    "value": round(random.uniform(0, 100), 2),
                    "ts": int(t * 1000),
                    "pad": pad,
                })
                client.publish(topic, payload)
                sent += 1
            if t - last_report >= 1.0:
                print(f"  ~{(sent - reported_sent) / (t - last_report):.0f} msg/s (total {sent})")
                last_report = t
                reported_sent = sent
            elapsed = time.time() - t
            if elapsed < slice_s:
                time.sleep(slice_s - elapsed)
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        client.disconnect()
        print(f"Sent {sent} messages in {time.time() - start:.1f}s")


if __name__ == "__main__":
    main()
