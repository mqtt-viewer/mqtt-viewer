#!/usr/bin/env python3
"""
Sparkplug B flood publisher for MQTT Viewer performance testing.

mqtt-flood.py floods plain JSON; this floods a plant-sized Sparkplug B fleet
so the stateful decode, the session store and the Sparkplug view are
measured at scale. Every edge node births once (metrics with engineering
units, one device each), then reports by exception: each NDATA or DDATA
carries only a handful of changed metrics, the way real edge nodes publish.
It answers NCMD rebirth requests like a real node would.

Usage:
    scripts/.venv/bin/python scripts/sparkplug-flood.py --port 1883 --rate 1000
    scripts/.venv/bin/python scripts/sparkplug-flood.py --nodes 500 --metrics 50 --rate 2000

Ctrl-C to stop. Prints achieved msg/s once per second. Reuses the protobuf
encoder in mqtt-sim.py (no protobuf dependency).
"""
import argparse
import importlib.util
import os
import random
import sys
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit("paho-mqtt not installed. Run: scripts/.venv/bin/pip install paho-mqtt")

_spec = importlib.util.spec_from_file_location(
    "mqtt_sim", os.path.join(os.path.dirname(os.path.abspath(__file__)), "mqtt-sim.py"))
sim = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sim)

GROUP = "Plant"
UNITS = ["V", "A", "kW", "degC", "bar", "m3/h", "%", "rpm"]


class Scope:
    """A node or device: its metrics' current values and its topic."""

    def __init__(self, topic, metric_count):
        self.topic = topic
        self.values = [random.uniform(0, 1000) for _ in range(metric_count)]


def birth_payload(scope, seq, bd_seq=None):
    metrics = []
    if bd_seq is not None:
        metrics.append(sim.encode_metric(name="bdSeq", alias=0, datatype=sim.DT_INT64,
                                         value=bd_seq, value_type="long"))
    for i, v in enumerate(scope.values):
        metrics.append(sim.encode_metric(
            name=f"Area{i // 10}/Tag{i}", alias=i + 1, datatype=sim.DT_DOUBLE,
            value=v, value_type="double",
            properties=[("engUnit", sim.DT_STRING, UNITS[i % len(UNITS)])]))
    return sim.encode_payload(timestamp=sim.now_ms(), metrics=metrics, seq=seq)


def data_payload(scope, seq, changed):
    metrics = []
    for i in random.sample(range(len(scope.values)), min(changed, len(scope.values))):
        scope.values[i] += random.uniform(-1, 1)
        metrics.append(sim.encode_metric(alias=i + 1, value=scope.values[i], value_type="double"))
    return sim.encode_payload(timestamp=sim.now_ms(), metrics=metrics, seq=seq)


def main():
    ap = argparse.ArgumentParser(description="Sparkplug B flood publisher")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--rate", type=int, default=1000, help="target data messages/second")
    ap.add_argument("--nodes", type=int, default=300, help="edge nodes")
    ap.add_argument("--metrics", type=int, default=40, help="metrics per edge node")
    ap.add_argument("--device-metrics", type=int, default=10,
                    help="metrics on each node's one device (0 for no devices)")
    ap.add_argument("--changed", type=int, default=4, help="metrics per data message")
    ap.add_argument("--duration", type=float, default=0, help="seconds to run (0 = forever)")
    args = ap.parse_args()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                         client_id=f"sparkplug-flood-{random.randint(1000, 9999)}")
    client.connect(args.host, args.port)
    client.loop_start()

    nodes = []
    for n in range(args.nodes):
        node_id = f"edge-{n:04d}"
        node = {
            "id": node_id,
            "seq": 0,
            "bd_seq": 0,
            "scope": Scope(f"spBv1.0/{GROUP}/NDATA/{node_id}", args.metrics),
            "device": (Scope(f"spBv1.0/{GROUP}/DDATA/{node_id}/dev-0", args.device_metrics)
                       if args.device_metrics > 0 else None),
        }
        nodes.append(node)

    def next_seq(node):
        s = node["seq"]
        node["seq"] = (s + 1) % 256
        return s

    def birth(node):
        node["seq"] = 0
        client.publish(f"spBv1.0/{GROUP}/NBIRTH/{node['id']}",
                       birth_payload(node["scope"], next_seq(node), node["bd_seq"]))
        if node["device"] is not None:
            client.publish(f"spBv1.0/{GROUP}/DBIRTH/{node['id']}/dev-0",
                           birth_payload(node["device"], next_seq(node)))

    by_id = {node["id"]: node for node in nodes}

    def on_ncmd(_client, _userdata, msg):
        node = by_id.get(msg.topic.split("/")[3]) if msg.topic.count("/") >= 3 else None
        if node is not None:
            node["bd_seq"] += 1
            birth(node)

    ncmd = f"spBv1.0/{GROUP}/NCMD/#"
    client.subscribe(ncmd)
    client.message_callback_add(ncmd, on_ncmd)

    for node in nodes:
        birth(node)
    print(f"birthed {len(nodes)} edge nodes; flooding at {args.rate} msg/s", flush=True)

    interval = 1.0 / args.rate
    start = time.monotonic()
    next_at = start
    sent = 0
    window_start = start
    window_sent = 0
    try:
        while True:
            now = time.monotonic()
            if args.duration and now - start >= args.duration:
                break
            if now < next_at:
                time.sleep(min(next_at - now, 0.01))
                continue
            node = random.choice(nodes)
            if node["device"] is not None and random.random() < 0.3:
                client.publish(node["device"].topic,
                               data_payload(node["device"], next_seq(node), args.changed))
            else:
                client.publish(node["scope"].topic,
                               data_payload(node["scope"], next_seq(node), args.changed))
            sent += 1
            window_sent += 1
            next_at += interval
            if now - window_start >= 1.0:
                print(f"  ~{window_sent / (now - window_start):.0f} msg/s  (total {sent})", flush=True)
                window_start = now
                window_sent = 0
    except KeyboardInterrupt:
        pass
    client.loop_stop()
    client.disconnect()


if __name__ == "__main__":
    main()
