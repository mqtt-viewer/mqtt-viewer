# Stateful Sparkplug decode — build spec

Branch: `feat/sparkplug-session` → PR into `develop`.
Status: draft for maintainer review. Wireframes below are the main
deliverable — read those first.

## The problem, in plain terms

Sparkplug B devices announce themselves once with a birth certificate
(NBIRTH for an edge node, DBIRTH for a device behind it). The birth
carries the full metric list: names, numeric aliases, datatypes, initial
values. Every message after that (NDATA/DDATA) is a delta: it contains
only alias numbers and changed values, no names, because the spec
requires senders to omit names once aliases are established.

MQTT Viewer today decodes each Sparkplug message independently
(`mqtt-middleware/protobuf_decode.go`: topic prefix → protojson). So a
user watching live traffic sees this on every NDATA:

```json
{ "metrics": [ { "alias": 3, "doubleValue": 239.9 } ] }
```

Alias 3 means nothing without the NBIRTH that defined it. To be useful
the client must remember birth state per edge node for the life of the
session, then rewrite data messages with real names. That memory is
what "stateful" means.

## Competitive check and demand evidence (verified 2026-07-17)

No standalone desktop client does stateful resolution — all decode
per-message:

- MQTT Explorer: confirmed from source
  (`app/src/decoders/SparkplugBDecoder.ts`) — ~30 stateless lines,
  topic-regex detection. Its payload-sniffing approach also misfires
  on plain text (issues #792, #853): a cautionary tale for detection
  design below.
- Chariot MQTT Client (Cirrus Link, closest desktop competitor):
  per-message decode only, MQTT-topic tree not a semantic node tree.
- MQTT.fx 5: single-payload Cirrus decoder, no birth state.
- MQTTX: Sparkplug decode still backlogged (issue #996, open since
  2022).
- Stateful resolution exists only broker/host-side: EMQX rule engine
  `spb_decode` (>=6.0.2), HiveMQ InfluxDB extension, full SCADA hosts
  (Ignition, OAS, Tahu host).

Demand, strongest first:

- Our own discussion #14: adamwoodland2 wants to "just sit there
  watching the messages rather than be active in the state process"
  and names the need for stateful birth/death content — a passive
  stateful viewer, verbatim. thebaldgeek describes the
  connect-disconnect-paste-reconnect dance the current flow forces.
- Inductive Automation forum #73575: engineer stared at raw payloads
  in MQTT.fx while MQTT Engine complained about missing sequence
  numbers — a seq-aware view would have caught it.
- Opto22 forum 5314: rebirth loop between Groov RIO and Ignition — the
  rebirth-storm warning scenario.
- MQTT Explorer #427 and ThingsBoard #4086: long-standing decode
  requests.

## What the feature does

1. **Alias resolution.** Track NBIRTH/DBIRTH per
   group/edge-node/device. Rewrite NDATA/DDATA payload views to show
   metric names alongside values. If data arrives before a birth was
   seen, show aliases with an "unresolved — no birth seen" warning and
   offer a rebirth request.
2. **Sparkplug tree view.** A live inventory built from births + datas:
   groups → edge nodes → devices → metrics, each metric with last
   value, datatype, last-seen, stale flag. This is the view engineers
   currently reconstruct by hand.
3. **Health diagnostics.** Per edge node: sequence-number gap
   detection (seq must cycle 0-255 without gaps; a gap means missed
   messages), bdSeq tracking across reconnects, rebirth-storm warning
   (repeated births in a short window — classic duplicate-client-ID
   symptom), STATE topic tracking for primary host online/offline.
4. **Active debugging.** Right-click an edge node → "Request rebirth"
   (publishes the standard NCMD `Node Control/Rebirth` = true). This is
   what an engineer does manually today with a hand-typed publish.

## Wireframes

### A. Sparkplug tab in the data panel

Lives as a third mode on the existing List ⇄ Graph toggle in
`MqttDataPanel` (graph view PR #76 adds the toggle; this slots in even
if #76 stays parked — the toggle then has two entries).

```
┌──────────────────────────────────────────────────────────────────┐
│ [List] [Graph] [Sparkplug]                    filter: [________] │
├──────────────────────────────────────────────────────────────────┤
│ HOST STATE: scada-primary ● online       since 09:12:04          │
├──────────────────────────────────────────────────────────────────┤
│ ▾ Group: EnergyCo                                                │
│   ▾ ⬢ substation-7      ● ONLINE   seq ✓   bdSeq 3   12 metrics  │
│     │  Metric              Type     Value     Last seen          │
│     │  Volts/L1            Float    239.9     2s                 │
│     │  Volts/L2            Float    240.1     2s                 │
│     │  Amps/L1             Float    13.2      2s                 │
│     │  Breaker/State       Boolean  true      4m   ⚠ stale       │
│     ▾ ▣ meter-01          ● ONLINE                               │
│        Energy/kWh          Double   48211.4   1s                 │
│        Energy/Demand       Float    3.2       1s                 │
│   ▸ ⬢ substation-9        ○ OFFLINE  (death 12m ago)             │
│                                                                  │
│   ⚠ substation-4: seq gap (expected 41, got 44) at 09:31:02      │
│   ⚠ substation-4: 6 rebirths in 90s — possible duplicate client  │
└──────────────────────────────────────────────────────────────────┘
```

- ⬢ edge node, ▣ device. Stale = no update for N × the node's
  observed publish cadence (heuristic, tune later; show threshold in
  tooltip).
- Context menu on a node: Request rebirth · Copy metric list ·
  Export session (CSV/JSON).
- Warnings strip pinned at the bottom of the affected group; also
  badged on the tab label.

### B. Payload view of an NDATA message (existing panel, enhanced)

```
┌─ Payload ── spBv1.0/EnergyCo/NDATA/substation-7 ─────────────────┐
│ Sparkplug B · decoded · aliases resolved from NBIRTH 09:12:07    │
│ {                                                                │
│   "seq": 42,                                                     │
│   "metrics": [                                                   │
│     { "name": "Volts/L1",   // alias 3                           │
│       "doubleValue": 239.9, "timestamp": 1752701530 },           │
│     { "name": "Amps/L1",    // alias 5                           │
│       "doubleValue": 13.2,  "timestamp": 1752701530 }            │
│   ]                                                              │
│ }                                                                │
└──────────────────────────────────────────────────────────────────┘
```

Unresolved case: banner reads "aliases unresolved — no birth seen.
[Request rebirth]" and metrics keep bare aliases.

## Implementation sketch

### Backend: session store

New `backend/sparkplug/` package:

```go
type SessionStore struct {         // one per connection
    nodes map[nodeKey]*NodeState   // group + edgeNode
}
type NodeState struct {
    Online     bool               // flips on NBIRTH / NDEATH
    BdSeq      uint64
    LastSeq    int16              // -1 until first birth
    Aliases    map[uint64]MetricInfo   // NODE alias space only
    Devices    map[string]*DeviceState
    Metrics    map[string]MetricValue  // name -> last value, ts
    BirthAt    time.Time
    BirthCount []time.Time        // ring, rebirth-storm detection
}
type DeviceState struct {
    Online  bool                  // flips on DBIRTH / DDEATH
    Aliases map[uint64]MetricInfo // DEVICE alias space, separate
    Metrics map[string]MetricValue
}
```

Rules the store must honour (from field research):

- Node and device alias spaces are separate namespaces: the same
  alias number can mean different metrics at node vs device level.
  Key resolution on (group, edgeNode[, device]).
- Aliases are optional. Three cases: name+alias in birth then
  alias-only data (resolve); name present in every message (pass
  through, still populate the tree); alias-only data with no birth
  seen (render `alias_<n>` placeholder — mirrors EMQX's fallback —
  and flag unresolved).
- A new NBIRTH/DBIRTH flushes and rebuilds that scope's alias map.
  Never merge — stale mappings resolve silently to wrong names.
- NDEATH/DDEATH mark the scope offline; correlate NDEATH bdSeq with
  the birth's bdSeq (the broker delivers NDEATH as the will).
- On opening the Sparkplug view, replay the connection's in-RAM
  message history through the store so births received earlier in
  the session resolve immediately.
- Timestamps: show payload timestamp and arrival time — device
  clocks lie.
- Metric flags `is_null`, `is_historical`, `is_transient` surface as
  badges, not silently dropped.

- Fed from the message pipeline after proto decode; topic parse gives
  message type (NBIRTH/NDATA/...) from segment 3 of
  `spBv1.0/{group}/{type}/{node}[/{device}]`.
  `topic-matching/matches_sparkplug.go` already anchors the prefix.
- Detection is strict topic grammar with an exact message-type
  whitelist (NBIRTH, NDEATH, DBIRTH, DDEATH, NDATA, DDATA, NCMD,
  DCMD, STATE). Never payload-sniff — that is exactly what makes
  MQTT Explorer mis-decode plain text (its issues #792/#853).
- Decode middleware consults the store to emit an enriched payload
  (names injected) plus `SparkplugMeta` middleware properties
  (resolved flag, seq status). Keep the raw decoded form available for
  the Headers/raw view.
- Session store is in-memory per connection, reset on disconnect
  (aliases are only valid per MQTT session — same rule EMQX applies).
  bdSeq lets us correlate reconnects.
- Events: throttled `sparkplug:tree-updated` per connection (follow
  the broker-status store pattern — snapshot + delta, perf-tested; see
  `broker-status-store.perf.test.ts` for the precedent).
- STATE topics: parse both the 3.0 form `spBv1.0/STATE/{host_id}`
  (JSON `{"online":bool,"timestamp":ms}`) and the legacy 2.2 form
  (root-level `STATE/{host_id}`, plain ONLINE/OFFLINE string).
- Rebirth: `PublishNodeRebirth(connectionID, group, node)` builds the
  NCMD with `Node Control/Rebirth` metric per spec.

### Frontend

- New `SparkplugPanel` view component + store consuming tree events
  (design-system gate: colocated `.spec.json` + story).
- Toggle entry in `MqttDataPanel`; only shown once a connection has
  seen at least one `spBv1.0/#` message (avoids noise for non-SP
  users).
- Payload banner + name injection driven by `SparkplugMeta` props.

### Performance bar

Must hold the 2×2000 msg/s flood (`/perf-check`). Alias lookup is one
map hit per metric; the risk is event fan-out — batch tree updates on
an interval (250ms) like the broker status store does. Extend
`scripts/mqtt-sim.py` with a Sparkplug mode (births + aliased datas +
seq faults) for testing; also gives the sim a marketing-adjacent use.

## Scope cuts (v1)

- No DataSet/Template/PropertySet rich rendering — scalars +
  string/bool only; complex types fall back to raw protojson.
- No NCMD/DCMD metric *writes* (only rebirth). Writes are a natural v2
  with a confirm dialog.
- No persistence of session state across app restarts.
- No Sparkplug-Aware broker `$sparkplug/certificates/#` bootstrap
  (v2: brokers like HiveMQ with the Sparkplug-Aware extension retain
  births there — subscribing gives instant alias maps for late
  joiners without a rebirth. Worth doing soon; births are normally
  not retained, so late joining is the most common failure mode).
- spAv1.0 legacy stays static decode only (marked obsolete upstream).

## Positioning

Industry term for the receiving side is "Sparkplug Host Application";
the spec builds a passive secondary consumer that still tracks state —
a wire tap with diagnostics (adamwoodland2's own framing in
discussion #14). Benefit phrase for copy: "see the metric names, not
the aliases". Defensible claim, verified against every desktop
competitor above: connect and watch — aliases resolved to real metric
names, sequence gaps and rebirth storms flagged, live group to metric
tree, without becoming a host application or disturbing the primary
SCADA.

## Website

On merge, add an entry to `docs/WEBSITE_UPDATES.md`: features list, a
dedicated Sparkplug use-case page, and screenshot/short clip of the
session view. Use the Positioning section's claim — it is verified as
of 2026-07-17; re-verify competitors briefly before publishing.

## Open questions

1. Stale threshold heuristic: fixed (e.g. 5 min) or adaptive per
   metric cadence? Suggest fixed default with per-connection setting.
2. Should the Sparkplug tab replace the topic list for `spBv1.0`
   subtrees or coexist? Suggest coexist — raw view stays essential for
   debugging the decoder itself.
3. TCK: worth running the Eclipse Sparkplug TCK against the decode
   path for a "Sparkplug Compatible" claim? Separate task if so.
