# MQTT tooling competitive research (July 2026)

Round 1 of market research: repo state, MQTTX/EMQX, wider client landscape.
Compiled from three research passes on 2026-07-17. Round 2 (TUI/CLI tools,
home-automation ecosystem, industrial Sparkplug/UNS) appended when complete.

## Prioritised feature recommendations (synthesis)

### Existing moats to market harder

- Performance under flood (2x2000 msg/s bar). MQTTX's worst weakness:
  users report 44k-message histories freezing the app, >3GB RAM, black
  screens on long runs.
- Signed native builds including macOS ARM. Six of MQTT Explorer's top
  ten issues by reactions are broken/unsigned mac ARM builds.
- Protobuf + Sparkplug decode out of the box (Explorer #427 and MQTTX
  #996 both request it; only paid MQTT.fx matches).
- No telemetry. Explorer's most-reacted issue (16 reactions) is "remove
  telemetry".
- Visibly maintained. Explorer is abandoned (years in beta, pinned
  "looking for maintainer" issue); mqtt-spy dead since ~2016. Users fear
  picking a dead tool.

### Tier 1: high demand, cheap given existing code

1. Retained message manager. Browse all retained topics, clear
   one/recursive. PR #121 already adds retained tracking + clear action;
   extend to a dedicated view. EMQX dashboard has it broker-side;
   Explorer users depend on recursive delete; MQTTX lacks it.
2. Per-topic protobuf schema binding. Map topic pattern to proto message
   type instead of one global schema. MQTTX's most-repeated open request
   (issues #1371, #1997, #1971). Codec + registry already exist.
3. Saved publish templates (canned publishes). MQTTX top-reacted ask
   (#532, plus #1185, #1086). Publish history + collections + the
   sidebar-collections spec cover most of the ground.
4. Hex view + hex send. Explorer #280 (12 reactions) + #601 (9). Verify
   the current hex codec covers both read and compose sides.
5. Per-topic message-rate ranking ("what's flooding my broker").
   Explorer #210. Topic graph already computes EWMA rates; surface as a
   sortable list in the broker status page.

### Tier 2: differentiation ("Postman for MQTT" whitespace)

6. Environments + variables. `{{deviceId}}` substitution in
   topics/payloads, one-click dev/staging/prod broker+creds swap. No
   MQTT GUI does this.
7. Scripted assertions + headless CI runner. "Publish X, expect reply on
   Y within N ms." mqtt-spy proved demand then died; MQTT.fx charges
   EUR 220-1900/yr partly for scripting. Most credible premium tier.
8. Git-friendly plain-text export of connections/collections (Bruno
   thesis: diffable, PR-reviewable device test suites).
9. In-app device simulator + bench harness. `mqtt-sim.py` and
   `mqtt-flood.py` already exist; surface natively. MQTTX bench CLI is a
   headline feature.

### Tier 3: parity, lower urgency

10. Avro + MessagePack codecs (MQTTX and MQTT.fx have them).
11. Broker observability extension: connected-client list, subscription
    introspection via $SYS, optional EMQX REST enrichment.
12. Scheduled/timed publishing (soak testing).
13. AI copilot: MQTTX's marketing headline, low real utility signal.

### Skip

- WebUI (issue #119). MQTTX Web owns that niche free; conflicts with
  desktop + Wails architecture and the licensing model.

### Housekeeping before new features

- Decide topic graph (PR #76) fate; it blocks the #121 stack.
- Close stale "in progress" issues (#96, #81, #106, #4 look resolved by
  merged or open PRs).
- Fix AppImage blank screen (#48).
- Windows ARM (#107) extends the signed-builds moat.

---

## Report 1: repo state (issues, PRs, current features)

### Open issues (7)

- #119 [FEAT] WebUI: web/browser version (possibly Docker) as
  alternative to desktop app.
- #107 [BUG] Windows ARM support: installer refuses Windows 11 ARM.
  Labelled in progress.
- #106 [FEAT] More chart time window options (3h/6h/12h/1d/custom).
  Appears resolved by PR #112.
- #96 [FEAT] Flatpak release. PR #97 merged 2026-07-07; needs closing.
- #81 [FEAT] Panel repositioning. Likely satisfied by PR #92 (dockable
  topic panel).
- #48 [BUG] AppImage + some mac builds open to a blank screen
  (GTK/webkit warnings).
- #4 [FEAT] Better client logs. PR #104 delivers; open, close to done.

### Open PRs (6)

- #121 topic tree context menu (copy path/payload, export history, clear
  retained) + retained-message tracking index. Stacked on #76; green but
  manual two-broker click-through pending.
- #120 timeline hover preview. Small, green, verified. Mergeable.
- #116 docs-only: fresh-checkout go build embed stub. Done.
- #112 chart time window presets + custom interval, persisted per
  connection. Green; needs manual click-through.
- #104 per-connection MQTT client library logs viewer (ring buffer +
  rotating file, opt-in verbose). Mostly done; live e2e pending.
- #94 star-prompt visual polish. Done, cosmetic.
- #76 Topic Graph view (PixiJS tidy-tree, node size = EWMA rate, colour
  = recency, collapse/expand, pan/zoom/minimap, follow-hottest, prune).
  Complete and live-verified but parked; base for #121.

### Recently merged highlights

Broker status window (#118), light-mode consistency (#117), WebView2
dropdown fix (#111), EU decimal commas in charts (#110), WebSocket path
fix (#103), All-history chart window (#100), Flatpak (#97), topic
charting + pop-out (#75), bounded message memory (#74), light mode
(#69), changelog dialog (#80), star nudge (#88).

### Current feature surface

Multi-connection management, MQTT v3+v5, tabs with persisted state,
virtualized live topic tree with search, payload/headers/user-props
tabs, CodeMirror payload view with diff, message timeline scrubber,
ECharts topic charting with JSON-path field picker + pop-out window,
publish composer with history, collections (global + per-connection),
export, bounded in-RAM history with memory budget + opt-in disk
recording, protobuf codec + registry, Sparkplug A/B decode, base64/hex
codecs, image payload previews, broker status window ($SYS metrics),
light/dark themes, design system with Storybook CI, signed
mac/win/linux + Flatpak packaging.

### Specced but unbuilt or partial

- docs/specs/sidebar-collections.md: full message-library sidebar UX
  (13+ locked decisions); backend exists, frontend possibly partial.
- Topic context menu spec lives only on the #121 branch.

---

## Report 2: MQTTX / EMQX

### MQTTX power-user features (differentiators)

- Scripts: custom JS transforms on sent/received payloads; scheduled
  message sending.
- Schema codecs: Protobuf, Avro, MessagePack (Avro + MessagePack are
  MQTT Viewer gaps).
- Benchmark (desktop + CLI bench conn/sub/pub, rate-controlled,
  --payload-size).
- IoT data simulation: built-in scenario scripts generating realistic
  sensor streams.
- Copilot (AI): multi-model, MCP integration (v1.12), generates test
  data, client code, schemas.
- v1.13: payload inspector with message diff + JSON tree view; quick
  copy; topic whitespace warning.

### EMQX dashboard ideas a client can partially replicate

Client list with per-client session info; subscription introspection
(client ID + topic + QoS, filterable); retained message management
(browse/delete); slow subscription diagnostics; per-topic metrics.
Broker-agnostic subset available via $SYS; richer via EMQX REST API.

### Top MQTTX user requests (GitHub reactions, low absolute counts)

- #532 saved pub list / canned publishes (4) + #1185, #1086.
- #776 run publish from script editor (4).
- #706 proxy settings (5).
- #1371 / #1997 / #1971 per-subscription/per-topic protobuf binding
  (repeated, strongest theme).
- #1893 scripts conditional on subscription topic.
- #996 Sparkplug B decode (MQTT Viewer already has).
- #1211 dedicated $SYS monitoring UI.
- #1633 TLS 1.3; #1933 SSLKEYLOGFILE for Wireshark.
- #470 batch connection delete; #1640/#1427 delete single subscription.
- #591 default message format per subscription.

### MQTTX weaknesses (confirmed via issues)

Falls over under load and large history (44k+ messages freeze it; DB
bloat; clear-history broken while disconnected); long-run stability
(#1104 stuck, >3GB RAM); message history UX disliked (#2034); Linux/
Flatpak friction; single global protobuf schema; clunky subscription
management; cluttered single-pane layout.

---

## Report 3: wider landscape

### MQTT Explorer (abandoned; user base up for grabs)

Topic-tree-first UX everyone copies: live tree, diff view, numeric
plotting, recursive topic delete, retained history. Stuck on 0.4.0 beta
for years; pinned maintainer-wanted issue #885.

Top issues by reactions: telemetry removal #538 (16), TLS cert expired
#596 (15), ship stable #687 (15), Apple Silicon #609/#1088/#790/#528/
#831 (15/15/14/13/12), hex view #280 (12), web-hosted mode #173 (10),
MQTT 5 #422 (10), hex send #601 (9), auto-connect #82 (7), payload cap
20KB raise #504/#919 (7/4), binary formats beyond JSON #508 (7), copy
history #523/#388, disk logging #632 (5), MQTT 5 user props #481 (4),
"pie chart of what's flooding broker" #210 (4), CSV plot export #497,
Sparkplug decode #427.

### MQTT.fx 5 (paid incumbent, Softblade)

Topic explorer scan, scripted pub/receive, logging console, decoders
incl. Msgpack + Sparkplug. Pricing: EUR 49.90 one-time private; EUR
220/yr single commercial; EUR 650/yr team-5; EUR 1900/yr enterprise.
Buyers pay for licensing legitimacy + support, not unique tech.

### Others

- HiveMQ: MQTT CLI (shell + single-command, CI-friendly), browser
  WebSocket client (dated, canonical quick-test tool).
- mqtt-spy (dead ~2016): scripted pubs/subs, auto-reply, automated test
  cases, headless daemon for CI. Proves scriptable-testing demand.
- MQTTAnalyzer (iOS/macOS, free): MQTT 5, TLS+ALPN, JSON highlighting,
  time-series charts; smart-home positioning.
- EasyMQTT (iOS, freemium): favourites, Zigbee2MQTT commands, graph
  widgets, Siri Shortcuts, HA presets. Monetizes convenience.
- MQTT Tiles (flespi): dashboard widgets (gauges/toggles/buttons),
  shareable dashboards, config stored as retained message on broker.
- Node-RED dashboard / ThingsBoard define gauge/control expectations.

### Cross-tool demand ranking

1. Working signed native builds (esp. mac ARM).
2. Hex view + hex send / raw binary editing.
3. Structured decode beyond JSON (protobuf, msgpack, Sparkplug).
4. No hard payload size caps.
5. Full MQTT 5 incl. user properties.
6. Persist/log to disk + copy history normally.
7. Auto-connect on launch.
8. Privacy / no telemetry.
9. Per-topic rate breakdown ("what's flooding the broker").
10. Scripted pub/sub + automated tests (biggest open market gap).

### Paid-feature patterns

MQTT.fx: only pure-play paid desktop client; moat is support/licensing
clarity/polish. Explorer's donation model stalled: proof free+donations
does not fund maintenance. Defensible paid story: maintained, signed,
private, fast, industrial-grade decode, pro UX. Automation/scripting
and team sharing are natural premium tiers.

### Postman/Insomnia/Bruno analogues

1. Environments + variables (broker profiles, {{var}} substitution).
2. Collections + scripted tests + headless CI runner (Newman
   equivalent).
3. Git-friendly plain-text config (Bruno thesis).
4. Mock servers -> MQTT device simulator/replay.
5. AI test-data generation (cheap demo-friendly premium).

---

## Report 4 (round 2): CLI / TUI / IDE / API clients

### mqttui (Rust TUI, ~700 stars, actively maintained)

Built because MQTT Explorer was too heavy. Wins on instant startup +
low footprint, deliberately not features. Subcommands: interactive TUI,
publish, log (stream to stdout), read-one (scripting), clean-retained
(interactive or CLI). In-terminal value plotting. Owns the
terminal-scripting crowd.

### Postman MQTT

Open beta since Sept 2023, never graduated (~3 years). MQTT 3.1.1/5,
TLS, WS, message-stream timeline UI. No scripting/tests, no saved
examples. Checkbox feature, not a threat. Insomnia: no MQTT (backlog
since 2021). Bruno: no MQTT. Hoppscotch: native MQTT in 6-protocol
free tool — the one to watch.

### VS Code

VSMqtt leads at ~29k installs: multi-broker profiles, topic pinning
with auto re-subscribe, colour-coded messages, CSV export, retained
clearing. Modest ceiling; convenience niche, not analysis surface.

### Grafana MQTT datasource

Live-only (no history stored), MQTT 3.1.x only. A built-in
"plot this topic over time" panel absorbs the quick-check use case
(MQTT Viewer already has charting; gap is closed).

### New entrants 2024-2026

- MqttInsight (Java, active): table + dialogue views; widest codec set
  (protobuf, MessagePack, Avro, Hessian, Kryo) plus user-scriptable
  JS/Java SPI decoders; message statistics charts. Most ambitious OSS
  newcomer.
- MqttDesk (closed-source): 27 dashboard widgets, operator-dashboard
  niche.
- No breakout launch dominating 2024-2026.

### Packet-level debugging gap (unique)

Devs drop to Wireshark for: missing CONNACK, missing PUBACK, QoS
handshake stalls, DUP retransmits. No client offers an ACK/control-
packet trace view (CONNACK reason codes, PUBACK/PUBREC/PUBREL/PUBCOMP
timing, DUP flags, v5 reason codes). SSLKEYLOGFILE export (also MQTTX
issue #1933) bridges to Wireshark when a pcap is still needed.

---

## Report 5 (round 2): home-automation segment

### Workflows and pain

- Zigbee2MQTT: watch state topics, send /set, /get; availability is a
  RETAINED online/offline message (top cause of "device unavailable");
  bridge/request/+ to bridge/response/+ correlation (permit_join, OTA,
  rename) painful in flat clients.
- HA MQTT discovery: retained configs on homeassistant/+/+/config.
  Non-retained config = entity vanishes on HA restart. Orphaned/ghost
  retained configs resurrect deleted devices; only fix today is manual
  hunt + publish empty retained payload (long forum threads, no
  dedicated tool exists).
- Device conventions: Tasmota cmnd/stat/tele, ESPHome, Frigate
  events/stats (high-rate JSON), ESPresense, OwnTracks.
- Cross-cutting: everything hinges on retained messages, LWT, JSON,
  and request-response correlation across sibling topics.

### Tools observed

MQTT Explorer is the reflexive forum recommendation (tree UX) but
performance + staleness complaints recur. HA built-in dev tool: one
topic filter, no tree, no retained management. Z2M frontend is not a
general inspector. Price anchor for plain inspection is $0.

### Feature ideas ranked for this segment

1. HA discovery browser + retained-config manager: parse
   homeassistant/# into device/entity view, flag non-retained configs,
   detect orphaned configs, one-click delete. Clear whitespace, the
   segment's loudest pain.
2. Retained-message awareness everywhere: mark retained + age, bulk
   clear on subtree.
3. Performance under load: wedge vs Explorer for Frigate/ESPresense
   traffic (existing strength).
4. Request/response correlation (bridge ops, /set vs /state).
5. Device-convention templates: auto-group Tasmota/Z2M/Frigate topics,
   surface availability ("smart home view").
6. Availability/LWT dashboard: every device's LWT state + last-seen.

### Monetisation read

Segment pays for outcomes, not viewers (Nabu Casa $65/yr precedent vs
$0 anchor for MQTT clients). Treat as top-of-funnel: generous free
capability that wins "best MQTT client for HA" threads, with discovery
browser + retained management as the paid hook. Volume, word-of-mouth,
SEO feed the industrial segment.

Note: check mqttviewer.app HA landing page framing — third-party
summaries describe MQTT Viewer as "free, open-source", which mismatches
the paid product.

---

## Report 6 (round 2): industrial Sparkplug / UNS

### Day-to-day workflow gaps

Sparkplug debugging = confirm NBIRTH, read birth for metric
names/aliases/types, watch NDATA deltas, verify seq 0-255 without gaps,
check STATE/<host_id>, issue NCMD rebirth when confused. Lightweight
tools handle none of the stateful parts. "Standard MQTT monitoring
tools cannot be used with Sparkplug" (Cedalo).

### Stateful decode competitive check (headline finding)

Alias resolution is stateful by spec: births carry name+alias, data
messages carry alias only. Who resolves correctly: EMQX broker rules
(session-scoped, broker-side), Ignition/Cirrus Link, N3uron, Canary
(heavyweight licensed platforms), code libraries (Tahu, pysparkplug).
Who does not: MQTT Explorer (per-message decode, bare aliases in
NDATA), MQTTX (no Sparkplug decode at all), HighByte UNS Client (docs
silent on alias resolution). **No standalone desktop client does full
stateful Sparkplug decode.** MQTT Viewer already has the protobuf
codec; the session state model on top is the defensible wedge.

### UNS landscape

UNS (ISA-95 hierarchy over MQTT) fast-growing. HighByte UNS Client is
the design target: topic tree, auto-detect JSON/SparkplugB decode,
publish pane — but locked inside the Intelligence Hub platform
purchase. Litmus, UMH (Redpanda Console) are platform plays. Engineers
default to DIY MING stack for lack of a purpose-built inspector.

### Industrial feature ideas ranked

Tier 1: (1) stateful Sparkplug session model (alias resolution
per Group/EdgeNode/Device); (2) node/device tree with per-metric
last-value, last-seen, datatype, stale flag; (3) seq/bdSeq/rebirth
diagnostics incl. rebirth-storm detection (verified field pain).
Tier 2: (4) send NCMD rebirth + NCMD/DCMD writes from the inspector;
(5) STATE tracking + primary-host timeline; (6) unified UNS/ISA-95
hierarchy view mixing JSON and Sparkplug; (7) retained-birth fetch.
Tier 3: (8) DataSet/Template/properties rich rendering; (9) Sparkplug
3.0 correctness (MQTT 5 Clean Start, JSON STATE payload); (10)
Sparkplug-Aware broker sys-topic browsing ($sparkplug/certificates);
(11) session export CSV/JSON. TCK validation = "Sparkplug Compatible"
logo, credibility marker. Sparkplug 3.0 is now ISO/IEC 20237:2023.

### Procurement notes

Air-gapped/offline licensing is the gate for OT buyers (signed offline
licence file, USB-transferable, zero phone-home); commands 3-5x
pricing. PO/invoice purchasing, perpetual or offline-friendly licence,
support SLA matter more than price. No-telemetry stance is already a
procurement advantage — write the security one-pager.

---

## Final combined ranking (rounds 1 + 2)

Ranked by user demand x differentiation / effort given existing code.

### Build next (tier 1)

1. **Retained message manager.** Browse, age, bulk/recursive clear.
   Demanded by every segment (HA ghosts, Z2M availability, Sparkplug
   retained births, Explorer users, EMQX dashboard parity). PR #121
   already adds the tracking index. Foundation for #4 below.
2. **Stateful Sparkplug session decode + diagnostics.** Alias
   resolution, birth-vs-data tree with stale flags, seq/bdSeq gap +
   rebirth-storm detection. No standalone client does it; the segment
   that pays; codec already exists.
3. **Per-topic protobuf schema binding.** MQTTX's most-repeated ask;
   natural sibling of #2.
4. **HA discovery browser + ghost-config cleanup.** Loudest hobbyist
   pain, zero dedicated tools, builds directly on #1. Funnel play.
5. **Per-topic message-rate ranking** in broker status page. EWMA rates
   already computed; Explorer #210; cheap.

### Differentiation (tier 2)

6. **Scriptable payload decoders** (user JS hook + Avro/MessagePack
   built-ins). Leapfrogs MqttInsight, answers MQTTX conditional-script
   asks.
7. **CLI companion** (pub, log, read-one, clean-retained headless).
   Captures mqttui's niche, seeds the CI runner.
8. **Environments + variables** ({{var}} in topics/payloads, broker
   profile swap). No MQTT GUI does it.
9. **Canned publish templates.** Sidebar-collections spec covers most;
   seed with Z2M/Tasmota/HA presets for segment value.
10. **Request/response correlation** (Z2M bridge, /set vs /state,
    MQTT 5 response-topic).

### Later (tier 3)

11. **Scripted assertions + headless CI runner** (grows out of 7+8;
    premium tier; "Postman for MQTT").
12. **ACK/control-packet trace view + SSLKEYLOGFILE export.** Unique
    gap, removes Wireshark round-trips.
13. **In-app simulator/bench** (surface mqtt-sim/flood natively).
14. **UNS/ISA-95 hierarchy view** (extends 2; HighByte-without-the-
    platform).
15. **Availability/LWT dashboard**; device-convention templates.
16. **Scheduled publishing; broker client-list/subscription
    introspection; Avro/MessagePack if not folded into 6.**

### Business moves (not features)

- Air-gapped licence SKU + PO/invoice path + security one-pager
  (no telemetry, outbound connections list). Unlocks OT procurement.
- Market existing moats: perf bar, signed mac ARM builds, no
  telemetry, maintained cadence, Sparkplug decode.
- Sparkplug TCK validation for the "Sparkplug Compatible" logo.
- Fix third-party "free, open-source" framing of mqttviewer.app.
