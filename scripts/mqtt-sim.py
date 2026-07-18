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
    scripts/.venv/bin/python scripts/mqtt-sim.py --sparkplug      # also run the Sparkplug B world
    scripts/.venv/bin/python scripts/mqtt-sim.py --self-test      # check the protobuf encoder, exit

Ctrl-C to stop. Each topic publishes on its own cadence; rates are msgs/sec.

--sparkplug adds a simulated Sparkplug B world (group "EnergyCo") alongside
the plain-JSON topics above rather than replacing them, so a broker can be
used to exercise both decode paths at once; see --help for the sub-flags.
"""
import argparse
import json
import math
import random
import signal
import struct
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


# ---------------------------------------------------------------------------
# Sparkplug B simulation (--sparkplug)
#
# Hand-rolled protobuf wire-format encoder for the subset of
# backend/protobuf/spBv1.proto used here — no protobuf pip dependency.
# Payload{timestamp=1 varint, metrics=2 repeated LEN, seq=3 varint,
#         uuid=4 LEN, body=5 LEN}
# Metric{name=1 LEN, alias=2 varint, timestamp=3 varint, datatype=4 varint,
#        is_historical=5 varint(bool), is_transient=6 varint(bool),
#        is_null=7 varint(bool), value oneof: int_value=10 varint,
#        long_value=11 varint, float_value=12 fixed32, double_value=13
#        fixed64, boolean_value=14 varint(bool), string_value=15 LEN}
# Field numbers confirmed against backend/protobuf/spBv1.proto.
# ---------------------------------------------------------------------------

SP_GROUP = "EnergyCo"

WIRE_VARINT = 0
WIRE_FIXED64 = 1
WIRE_LEN = 2
WIRE_FIXED32 = 5

# subset of the DataType enum in spBv1.proto
DT_INT64 = 4
DT_FLOAT = 9
DT_DOUBLE = 10
DT_BOOLEAN = 11


def _varint(n):
    """Encode a non-negative int as a protobuf base-128 varint."""
    out = bytearray()
    n &= (1 << 64) - 1
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _tag(field_num, wire_type):
    return _varint((field_num << 3) | wire_type)


def _f_varint(field_num, value):
    return _tag(field_num, WIRE_VARINT) + _varint(int(value))


def _f_bool(field_num, value):
    return _f_varint(field_num, 1 if value else 0)


def _f_len(field_num, data):
    return _tag(field_num, WIRE_LEN) + _varint(len(data)) + data


def _f_string(field_num, s):
    return _f_len(field_num, s.encode("utf-8"))


def _f_float(field_num, value):
    return _tag(field_num, WIRE_FIXED32) + struct.pack("<f", value)


def _f_double(field_num, value):
    return _tag(field_num, WIRE_FIXED64) + struct.pack("<d", value)


def encode_metric(name=None, alias=None, timestamp=None, datatype=None,
                   is_historical=None, is_transient=None, is_null=None,
                   value=None, value_type=None):
    """Build one Metric submessage. value_type selects the value oneof
    field: "int"=10, "long"=11, "float"=12, "double"=13, "bool"=14,
    "string"=15. Omit value/value_type (or pass is_null=True) for a metric
    with no value."""
    out = bytearray()
    if name is not None:
        out += _f_string(1, name)
    if alias is not None:
        out += _f_varint(2, alias)
    if timestamp is not None:
        out += _f_varint(3, timestamp)
    if datatype is not None:
        out += _f_varint(4, datatype)
    if is_historical is not None:
        out += _f_bool(5, is_historical)
    if is_transient is not None:
        out += _f_bool(6, is_transient)
    if is_null is not None:
        out += _f_bool(7, is_null)
    if value_type is not None and not is_null:
        if value_type == "int":
            out += _f_varint(10, value)
        elif value_type == "long":
            out += _f_varint(11, value)
        elif value_type == "float":
            out += _f_float(12, value)
        elif value_type == "double":
            out += _f_double(13, value)
        elif value_type == "bool":
            out += _f_bool(14, value)
        elif value_type == "string":
            out += _f_string(15, value)
        else:
            raise ValueError(f"unknown value_type {value_type!r}")
    return bytes(out)


def encode_payload(timestamp=None, metrics=None, seq=None, uuid=None, body=None):
    """Build a full Payload message. metrics is a list of already-encoded
    Metric submessages (from encode_metric)."""
    out = bytearray()
    if timestamp is not None:
        out += _f_varint(1, timestamp)
    for m in metrics or ():
        out += _f_len(2, m)
    if seq is not None:
        out += _f_varint(3, seq)
    if uuid is not None:
        out += _f_string(4, uuid)
    if body is not None:
        out += _f_len(5, body)
    return bytes(out)


def self_test():
    """Encode known payloads and assert exact wire bytes, built by hand
    (independently of the helpers above) so this actually catches
    wire-format bugs rather than just echoing them back."""
    metric = encode_metric(name="A", alias=1, datatype=3, value=42, value_type="int")
    expected_metric = (
        b"\x0a\x01A"  # field 1 (name), LEN, "A"
        b"\x10\x01"  # field 2 (alias), varint 1
        b"\x20\x03"  # field 4 (datatype), varint 3
        b"\x50\x2a"  # field 10 (int_value), varint 42
    )
    assert metric == expected_metric, f"metric: {metric.hex()} != {expected_metric.hex()}"

    payload = encode_payload(metrics=[metric], seq=7)
    expected_payload = (
        b"\x12" + bytes([len(expected_metric)]) + expected_metric  # field 2 (metrics), LEN
        + b"\x18\x07"  # field 3 (seq), varint 7
    )
    assert payload == expected_payload, f"payload: {payload.hex()} != {expected_payload.hex()}"

    f = encode_metric(alias=2, datatype=DT_FLOAT, value=1.5, value_type="float")
    expected_f = b"\x10\x02" + b"\x20\x09" + b"\x65" + struct.pack("<f", 1.5)
    assert f == expected_f, f"float metric: {f.hex()} != {expected_f.hex()}"

    d = encode_metric(alias=3, datatype=DT_DOUBLE, value=2.25, value_type="double")
    expected_d = b"\x10\x03" + b"\x20\x0a" + b"\x69" + struct.pack("<d", 2.25)
    assert d == expected_d, f"double metric: {d.hex()} != {expected_d.hex()}"

    b_ = encode_metric(alias=6, datatype=DT_BOOLEAN, value=True, value_type="bool")
    expected_b = b"\x10\x06" + b"\x20\x0b" + b"\x70\x01"
    assert b_ == expected_b, f"bool metric: {b_.hex()} != {expected_b.hex()}"

    n = encode_metric(alias=5, is_null=True)
    expected_n = b"\x10\x05" + b"\x38\x01"
    assert n == expected_n, f"null metric: {n.hex()} != {expected_n.hex()}"

    print("self-test OK")
    return True


def _metric(name, alias, datatype, value, value_type, spread=0.0, lo=None, hi=None,
            monotonic=False):
    if lo is None:
        lo = value - spread * 4
    if hi is None:
        hi = value + spread * 4
    return {"name": name, "alias": alias, "datatype": datatype, "value": value,
            "value_type": value_type, "spread": spread, "lo": lo, "hi": hi,
            "monotonic": monotonic}


def _drift(m):
    if m["value_type"] == "bool":
        return (not m["value"]) if random.random() < 0.02 else m["value"]
    if m["monotonic"]:
        v = m["value"] + abs(random.uniform(0, m["spread"]))
    else:
        v = max(m["lo"], min(m["hi"], m["value"] + random.uniform(-m["spread"], m["spread"])))
    return round(v, 3)


class DeviceSim:
    __slots__ = ("device_id", "metrics")

    def __init__(self, device_id, metrics):
        self.device_id = device_id
        self.metrics = metrics


class NodeSim:
    """One simulated Sparkplug B edge node. Owns the seq counter shared by
    itself and its devices (per spec, seq is one counter per edge-node
    session covering NBIRTH/NDATA/DBIRTH/DDATA), and the bdSeq counter that
    increments across death/rebirth cycles."""

    def __init__(self, client, node_id, metrics):
        self.client = client
        self.node_id = node_id
        self.metrics = metrics
        self.devices = []
        self.seq = 0
        self.bd_seq = 0
        self.data_count = 0
        self.alive = False

    def topic(self, msg_type, device_id=None):
        base = f"spBv1.0/{SP_GROUP}/{msg_type}/{self.node_id}"
        return f"{base}/{device_id}" if device_id else base

    def _next_seq(self):
        s = self.seq
        self.seq = (self.seq + 1) % 256
        return s

    def _bd_seq_metric(self):
        return encode_metric(name="bdSeq", alias=1, datatype=DT_INT64,
                              value=self.bd_seq, value_type="long")

    def publish_nbirth(self):
        self.seq = 0
        self.data_count = 0
        metrics = [self._bd_seq_metric()]
        for m in self.metrics:
            metrics.append(encode_metric(name=m["name"], alias=m["alias"], datatype=m["datatype"],
                                          value=m["value"], value_type=m["value_type"]))
        payload = encode_payload(timestamp=now_ms(), metrics=metrics, seq=self._next_seq())
        self.client.publish(self.topic("NBIRTH"), payload, qos=0, retain=False)
        self.alive = True

    def publish_ndeath(self):
        payload = encode_payload(timestamp=now_ms(), metrics=[self._bd_seq_metric()])
        self.client.publish(self.topic("NDEATH"), payload, qos=0, retain=False)
        self.alive = False

    def publish_ndata(self):
        # every ~20 messages, exercise the is_null / is_historical badges
        flagged = self.data_count > 0 and self.data_count % 20 == 0
        self.data_count += 1
        metrics = []
        for i, m in enumerate(self.metrics):
            m["value"] = _drift(m)
            if flagged and i == 0:
                metrics.append(encode_metric(alias=m["alias"], is_null=True))
            elif flagged and i == 1 and len(self.metrics) > 1:
                metrics.append(encode_metric(alias=m["alias"], datatype=m["datatype"],
                                              is_historical=True, value=m["value"],
                                              value_type=m["value_type"]))
            else:
                metrics.append(encode_metric(alias=m["alias"], datatype=m["datatype"],
                                              value=m["value"], value_type=m["value_type"]))
        payload = encode_payload(timestamp=now_ms(), metrics=metrics, seq=self._next_seq())
        self.client.publish(self.topic("NDATA"), payload, qos=0, retain=False)

    def publish_dbirth(self, device):
        metrics = [encode_metric(name=m["name"], alias=m["alias"], datatype=m["datatype"],
                                  value=m["value"], value_type=m["value_type"])
                   for m in device.metrics]
        payload = encode_payload(timestamp=now_ms(), metrics=metrics, seq=self._next_seq())
        self.client.publish(self.topic("DBIRTH", device.device_id), payload, qos=0, retain=False)

    def publish_ddata(self, device):
        metrics = []
        for m in device.metrics:
            m["value"] = _drift(m)
            metrics.append(encode_metric(alias=m["alias"], datatype=m["datatype"],
                                          value=m["value"], value_type=m["value_type"]))
        payload = encode_payload(timestamp=now_ms(), metrics=metrics, seq=self._next_seq())
        self.client.publish(self.topic("DDATA", device.device_id), payload, qos=0, retain=False)


def build_sparkplug_world(client):
    """Group "EnergyCo": substation-7 (+ device meter-01) is the rich,
    well-behaved node; substation-4 has a periodic seq gap; substation-9
    cycles offline/rebirth; substation-2 only exists for --sparkplug-storm."""
    substation7 = NodeSim(client, "substation-7", [
        _metric("Volts/L1", 3, DT_FLOAT, 11000.0, "float", spread=8.0, lo=10800, hi=11200),
        _metric("Volts/L2", 4, DT_FLOAT, 10995.0, "float", spread=8.0, lo=10800, hi=11200),
        _metric("Amps/L1", 5, DT_FLOAT, 120.0, "float", spread=6.0, lo=60, hi=200),
        _metric("Breaker/State", 6, DT_BOOLEAN, True, "bool"),
    ])
    meter01 = DeviceSim("meter-01", [
        # deliberately alias 3 — same alias number as substation-7's
        # Volts/L1, to exercise separate per-entity alias spaces.
        _metric("Energy/kWh", 3, DT_DOUBLE, 152340.5, "double", spread=0.4, monotonic=True),
        _metric("Energy/Demand", 4, DT_FLOAT, 450.0, "float", spread=25.0, lo=300, hi=650),
    ])
    substation7.devices.append(meter01)

    substation4 = NodeSim(client, "substation-4", [
        _metric("Freq/Hz", 3, DT_FLOAT, 50.0, "float", spread=0.05, lo=49.7, hi=50.3),
        _metric("Load/Pct", 4, DT_FLOAT, 65.0, "float", spread=4.0, lo=20, hi=95),
    ])

    substation9 = NodeSim(client, "substation-9", [
        _metric("Volts/L1", 3, DT_FLOAT, 11020.0, "float", spread=8.0, lo=10800, hi=11200),
    ])

    substation2 = NodeSim(client, "substation-2", [
        _metric("Status", 3, DT_BOOLEAN, True, "bool"),
    ])

    return {
        "substation-7": substation7,
        "substation-4": substation4,
        "substation-9": substation9,
        "substation-2": substation2,
    }


def start_sparkplug(client, args, start):
    """Publish STATE + initial births, subscribe to NCMD for rebirth
    requests, and return a tick(t) function for the caller's main loop to
    invoke every iteration (t is time.monotonic())."""
    nodes = build_sparkplug_world(client)
    n7, n4, n9, n2 = (nodes["substation-7"], nodes["substation-4"],
                       nodes["substation-9"], nodes["substation-2"])
    device7 = n7.devices[0]

    client.publish("spBv1.0/STATE/scada-primary",
                    json.dumps({"online": True, "timestamp": now_ms()}),
                    qos=1, retain=True)

    def on_ncmd(_client, _userdata, msg):
        parts = msg.topic.split("/")
        if len(parts) >= 4:
            node = nodes.get(parts[3])
            if node is not None:
                node.bd_seq += 1
                node.publish_nbirth()
                for d in node.devices:
                    node.publish_dbirth(d)
                print(f"  [sparkplug] rebirth requested for {node.node_id}: "
                      f"republished NBIRTH (bdSeq={node.bd_seq}, seq reset)")

    ncmd_filter = f"spBv1.0/{SP_GROUP}/NCMD/#"
    client.subscribe(ncmd_filter, qos=0)
    client.message_callback_add(ncmd_filter, on_ncmd)

    no_birth = args.sparkplug_no_birth

    def birth_n7():
        n7.publish_nbirth()
        n7.publish_dbirth(device7)

    state = {
        "n7_birthed": False,
        "n7_next_birth": start + (2.0 if no_birth else 0.0),
        "n7_next_data": start + (0.2 if no_birth else 1.0),
        "n7_next_dev_data": start + (2.2 if no_birth else 1.0),
        "n4_next_data": start + 1.0,
        "n4_next_fault": start + 60.0,
        "n9_phase": "alive",
        "n9_next_data": start + 1.0,
        "n9_next_transition": start + 30.0,
        "n2_next_birth": start + 10.0,
    }

    if not no_birth:
        birth_n7()
        state["n7_birthed"] = True
    n9.publish_nbirth()
    n4.publish_nbirth()

    def tick(t):
        if not state["n7_birthed"] and t >= state["n7_next_birth"]:
            birth_n7()
            state["n7_birthed"] = True

        if t >= state["n7_next_data"]:
            n7.publish_ndata()
            state["n7_next_data"] = t + 1.0

        if state["n7_birthed"] and t >= state["n7_next_dev_data"]:
            n7.publish_ddata(device7)
            state["n7_next_dev_data"] = t + 1.0

        if t >= state["n4_next_data"]:
            n4.publish_ndata()
            state["n4_next_data"] = t + 1.0
        if t >= state["n4_next_fault"]:
            before = n4.seq
            n4.seq = (n4.seq + 2) % 256
            print(f"  [sparkplug] seq fault on substation-4: skipped seq {before}-{n4.seq - 1}")
            state["n4_next_fault"] = t + 60.0

        if state["n9_phase"] == "alive":
            if t >= state["n9_next_data"]:
                n9.publish_ndata()
                state["n9_next_data"] = t + 1.0
            if t >= state["n9_next_transition"]:
                n9.publish_ndeath()
                state["n9_phase"] = "dead"
                state["n9_next_transition"] = t + 30.0
        else:
            if t >= state["n9_next_transition"]:
                n9.bd_seq += 1
                n9.publish_nbirth()
                state["n9_phase"] = "alive"
                state["n9_next_data"] = t + 1.0
                state["n9_next_transition"] = t + 30.0

        if args.sparkplug_storm and t >= state["n2_next_birth"]:
            n2.publish_nbirth()
            state["n2_next_birth"] = t + 10.0 + random.uniform(-1, 1)

    return tick


def main():
    ap = argparse.ArgumentParser(description="MQTT traffic simulator")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--scale", type=int, default=1, help="multiplier for the factory subtree size")
    ap.add_argument("--duration", type=float, default=0, help="seconds to run (0 = forever)")
    ap.add_argument("--anomaly", action="store_true", default=True,
                    help="periodically spike backyard/sensors/34/temperature")
    ap.add_argument("--sparkplug", action="store_true", default=False,
                    help="also simulate a Sparkplug B world (group \"EnergyCo\": "
                         "NBIRTH/NDATA with aliasing, a device under a node, a periodic "
                         "seq gap, an NDEATH/rebirth cycle, STATE, and NCMD->rebirth) "
                         "alongside the plain-JSON topics above. Payloads are hand-encoded "
                         "protobuf (see spBv1.proto) — no extra pip dependency.")
    ap.add_argument("--sparkplug-storm", action="store_true", default=False,
                    help="with --sparkplug, also make substation-2 re-publish NBIRTH "
                         "every ~10s (rebirth-storm symptom)")
    ap.add_argument("--sparkplug-no-birth", action="store_true", default=False,
                    help="with --sparkplug, delay substation-7's NBIRTH so its first "
                         "NDATA is published first, to exercise the app's unresolved "
                         "(data-before-birth) alias state")
    ap.add_argument("--self-test", action="store_true", default=False,
                    help="run the Sparkplug protobuf encoder self-test and exit "
                         "(no broker connection made)")
    args = ap.parse_args()

    if args.self_test:
        sys.exit(0 if self_test() else 1)

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

    sparkplug_tick = None
    if args.sparkplug:
        sparkplug_tick = start_sparkplug(client, args, start)

    total = sum(1 for p in pubs)
    sp_note = " + Sparkplug B world (EnergyCo)" if args.sparkplug else ""
    print(f"simulating {total} topics on {args.host}:{args.port} "
          f"(factory scale x{args.scale}){sp_note}. Ctrl-C to stop.")

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

        if sparkplug_tick is not None:
            sparkplug_tick(t)

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
