#!/usr/bin/env python3
"""
MQTT traffic simulator for MQTT Viewer development.

Publishes a realistic, hierarchical topic namespace at varied rates so the
Topic Graph view has something live to render — hot topics, slow topics,
idle/retained config topics, a large "factory" subtree for scale, and a
periodic anomaly spike on one topic.

Usage (broker defaults to localhost:1883):
    scripts/.venv/bin/python scripts/mqtt-sim.py
    scripts/.venv/bin/python scripts/mqtt-sim.py --scale 5 --host localhost --port 1883
    scripts/.venv/bin/python scripts/mqtt-sim.py --duration 120   # auto-stop after 2 min

Ctrl-C to stop. Each topic publishes on its own cadence; rates are msgs/sec.
"""
import argparse
import json
import math
import random
import signal
import sys
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit("paho-mqtt not installed. Run: scripts/.venv/bin/pip install paho-mqtt")


def now_ms():
    return int(time.time() * 1000)


def sensor_payload(base, unit, spread):
    val = round(base + random.uniform(-spread, spread), 2)
    return json.dumps({"value": val, "unit": unit, "ts": now_ms()})


def status_payload(states):
    return json.dumps({"state": random.choice(states), "ts": now_ms()})


def log_payload():
    levels = ["info", "info", "info", "warn", "debug"]
    msgs = ["heartbeat", "frame processed", "sync ok", "cache hit", "poll"]
    return json.dumps({"level": random.choice(levels), "msg": random.choice(msgs), "ts": now_ms()})


# (topic, rate_hz, builder) — rate_hz is mean messages/second; 0 = retained once then quiet
def build_topics(scale):
    t = []

    # backyard — has the hot anomaly topic
    t.append(("backyard/sensors/34/temperature", 2.0, lambda: sensor_payload(22, "C", 3)))
    t.append(("backyard/sensors/35/temperature", 0.7, lambda: sensor_payload(21, "C", 3)))
    t.append(("backyard/sensors/36/humidity", 0.4, lambda: sensor_payload(55, "%", 10)))
    t.append(("backyard/gateway/log", 1.0, log_payload))
    t.append(("backyard/gateway/status", 0.07, lambda: status_payload(["online", "online", "degraded"])))
    t.append(("backyard/cam/motion", 0.05, lambda: status_payload(["idle", "motion"])))
    t.append(("backyard/cam/snapshot", 0.01, lambda: json.dumps({"size": random.randint(40000, 90000)})))

    # house
    t.append(("house/livingroom/temperature", 0.5, lambda: sensor_payload(21, "C", 1.5)))
    t.append(("house/livingroom/humidity", 0.13, lambda: sensor_payload(48, "%", 6)))
    t.append(("house/kitchen/temperature", 0.1, lambda: sensor_payload(23, "C", 2)))
    t.append(("house/kitchen/co2", 0.03, lambda: sensor_payload(620, "ppm", 120)))
    t.append(("house/bedroom/temperature", 0.03, lambda: sensor_payload(20, "C", 1)))
    t.append(("house/hallway/motion", 0.2, lambda: status_payload(["idle", "motion"])))

    # house — published on the intermediate level itself (dual-role node test)
    t.append(("house/livingroom", 0.05, lambda: json.dumps({"occupancy": random.randint(0, 4), "ts": now_ms()})))

    # garden
    t.append(("garden/soil/moisture", 0.25, lambda: sensor_payload(40, "%", 8)))
    t.append(("garden/light/lux", 0.15, lambda: sensor_payload(800, "lx", 300)))
    t.append(("garden/pump/status", 0.004, lambda: status_payload(["off", "off", "on"])))  # mostly idle

    # retained config topics — publish once, then go quiet (cool to fully cold)
    t.append(("home/config/timezone", 0.0, lambda: json.dumps({"tz": "Australia/Sydney"})))
    t.append(("home/config/firmware", 0.0, lambda: json.dumps({"version": "1.4.2"})))

    # factory — large subtree for scale: lines x stations x metrics
    lines = 3 * scale
    for ln in range(1, lines + 1):
        for st in range(1, 9):
            base_rate = random.choice([0.02, 0.05, 0.1, 0.3])
            t.append((f"factory/line-{ln:02d}/station-{st:02d}/temperature", base_rate,
                      lambda: sensor_payload(60, "C", 8)))
            t.append((f"factory/line-{ln:02d}/station-{st:02d}/vibration", base_rate * 0.7,
                      lambda: sensor_payload(0.5, "g", 0.4)))
            t.append((f"factory/line-{ln:02d}/station-{st:02d}/state", 0.02,
                      lambda: status_payload(["running", "running", "idle", "fault"])))

    # $SYS-style broker metrics
    t.append(("$app/broker/clients", 0.05, lambda: json.dumps({"connected": random.randint(3, 12)})))
    t.append(("$app/broker/bytes", 0.1, lambda: json.dumps({"sent": random.randint(1000, 9000)})))
    t.append(("$app/broker/uptime", 0.008, lambda: json.dumps({"seconds": int(time.time()) % 100000})))

    return t


class Pub:
    __slots__ = ("topic", "rate", "builder", "retain", "next_t")

    def __init__(self, topic, rate, builder, retain, start):
        self.topic = topic
        self.rate = rate
        self.builder = builder
        self.retain = retain
        self.next_t = start + (random.expovariate(rate) if rate > 0 else 0)


def main():
    ap = argparse.ArgumentParser(description="MQTT traffic simulator")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--scale", type=int, default=1, help="multiplier for the factory subtree size")
    ap.add_argument("--duration", type=float, default=0, help="seconds to run (0 = forever)")
    ap.add_argument("--anomaly", action="store_true", default=True,
                    help="periodically spike backyard/sensors/34/temperature")
    args = ap.parse_args()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                         client_id=f"mqtt-sim-{random.randint(1000,9999)}")
    client.connect(args.host, args.port, keepalive=30)
    client.loop_start()

    start = time.monotonic()
    topics = build_topics(args.scale)
    pubs = [Pub(tp, rate, b, rate == 0.0, start) for (tp, rate, b) in topics]

    # publish retained config topics immediately
    for p in pubs:
        if p.rate == 0.0:
            client.publish(p.topic, p.builder(), qos=0, retain=True)

    total = sum(1 for p in pubs)
    print(f"simulating {total} topics on {args.host}:{args.port} "
          f"(factory scale x{args.scale}). Ctrl-C to stop.")

    running = {"v": True}

    def stop(*_):
        running["v"] = False
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    anomaly_topic = "backyard/sensors/34/temperature"
    last_anomaly = start
    in_anomaly_until = 0.0
    sent = 0
    last_report = start

    while running["v"]:
        t = time.monotonic()
        if args.duration and (t - start) >= args.duration:
            break

        # anomaly: every ~25s, spike the hot topic to ~15 msg/s for 4s
        if args.anomaly:
            if in_anomaly_until == 0.0 and (t - last_anomaly) > 25:
                in_anomaly_until = t + 4
                last_anomaly = t
            if in_anomaly_until and t > in_anomaly_until:
                in_anomaly_until = 0.0

        for p in pubs:
            if p.rate <= 0:
                continue
            if t >= p.next_t:
                rate = p.rate
                if in_anomaly_until and p.topic == anomaly_topic:
                    rate = 15.0
                client.publish(p.topic, p.builder(), qos=0, retain=False)
                sent += 1
                p.next_t = t + random.expovariate(rate)

        if t - last_report >= 5:
            rate_now = sent / (t - last_report)
            print(f"  ~{rate_now:.0f} msg/s  (total {sent})")
            sent = 0
            last_report = t

        time.sleep(0.01)

    client.loop_stop()
    client.disconnect()
    print("\nstopped.")


if __name__ == "__main__":
    main()
