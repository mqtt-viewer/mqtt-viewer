# MQTT tooling research, round 4 delta (July 2026)

Compiled 2026-07-30 from six further parallel passes: Reddit and social,
user reviews and app stores, adjacent-tool feature transplant, device and
integration ecosystems, industrial and OT forums, and website content,
distribution and monetisation.

Delta document again. Round 1+2 is `mqtt-tooling-research-2026-07.md`,
round 3 is `...-round3.md`. Both exclusion lists were given to every
agent, so everything below is new.

Round 4 was more productive than round 3. The transplant pass and the
device-ecosystem pass in particular found things no amount of reading
MQTT trackers would have surfaced.

## Coverage gap to close later

**Reddit is unreachable from these tools.** Three independent agents
tried the JSON API, `site:` searches, old.reddit, redlib and libreddit
mirrors, Jina reader, and Wayback. All blocked, and the block is at
policy level rather than rate limiting: WebFetch refuses the domain
outright and the browser pane refuses to navigate before any page loads.
DuckDuckGo did confirm relevant threads exist and are indexed (r/MQTT
"Cross-platform MQTT desktop client", r/homeassistant "Best MQTT client
for Windows 10/11", r/MQTT "Anything like MQTT Explorer for Android?")
but no method retrieved a thread body.

So r/homeassistant, r/IOT, r/PLC, r/SCADA, r/esp32, r/selfhosted and
r/embedded remain genuinely unresearched, in both the hobbyist and the
industrial direction. It is the single largest untapped source of
sentiment for this product. The reliable fix is a registered Reddit OAuth
app and the official API. Anonymous scraping is being actively defeated
and is not worth more attempts.

Also thin: Tasmota and ESPHome trackers (GitHub full-text relevance
ranking defeated the queries), and AlternativeTo, G2, Capterra and
Product Hunt, which turned out to have near-zero comments for this whole
category. Mobile app store reviews carried that pass instead.

## New ideas, ranked

### 1. GxP validation evidence bundle

The highest-value single finding of the round, and it is a segment I have
not been building for at all.

Regulated manufacturing (pharma, biotech, medical device) running a UNS
needs formal validation artifacts, not just a good security posture.
21 CFR Part 11, EMA Annex 11, GAMP 5, ALCOA+. EMQX's own biotech case
study puts numbers on it: 12 to 16 week change-control cycles, 2 to 3
days of manual compliance-report generation per change, 80-plus
interfaces each requiring individual validation, roughly 250 pages of
documentation per change. HiveMQ has two pharma posts making the same
IQ/OQ/PQ argument.

The artifact wanted is a **namespace validation snapshot**: topic
namespace structure at a point in time, ACL and topic-permission diff
against the previous snapshot, schema version approval trail, timestamped
and exportable, with the framework clause cited. That is a different
deliverable from raw session export, and it is the kind of thing that
justifies a price several times higher than a debugging tool normally
commands, because it displaces days of manual work per change.

This also composes with round 3's broker and snapshot diff: the diff
engine is the hard part, and the compliance bundle is the packaging.

Effort: medium, on top of snapshot diff. Do the diff first.

### 2. Copy as code

Right-click a publish or a subscription, get a ready-to-paste snippet
with the exact topic, QoS, payload and connection options filled in:
paho-mqtt for Python, mqtt.js for Node, `mosquitto_pub` and
`mosquitto_sub` for the shell, and Go for good measure.

Straight lift of "Copy as cURL" from browser devtools, which is one of
the most-used features in that whole product. Pure templating over data
the app already holds. No competitor has it.

Effort: low. Best value-per-hour item found in either round.

### 3. Schema explorer, meaning field-frequency inference

Sample the last N messages on a topic and show, per field, presence
percentage, type variance, min and max, and cardinality. MongoDB
Compass's Schema tab, applied to JSON payloads.

This is the generic sibling of per-topic protobuf binding: topics that
were never bound to a schema currently get nothing, and this tells you
what the payload shape actually is rather than what someone claimed it
is. Type variance is the money column, because inconsistent types across
messages on one topic is a real and common device bug that nothing
currently surfaces.

Effort: medium.

### 4. Connection truthfulness: publish canary and subscription liveness

Two findings that converge, and they land on something I have already
been fixing reactively.

A Frigate user had `frigate/available` reporting online, the UI working,
and zero messages arriving on `frigate/reviews`. Default logs said
nothing. The only way to find it was editing the *device's* log config,
which then revealed firewall errors. Separately, openHAB users run
`mosquitto_sub` in a second terminal purely to prove traffic is reaching
the broker, because the binding goes stale silently with TCP still up.
An EasyMQTT reviewer reports the live feed silently stopping until force
quit.

Note that PR #141 on my own repo is "reconnect when a v5 broker goes
silent". Same theme, found independently three more times. It is worth
treating as a product principle rather than a bug class:

- **Publish canary.** Distinguish "connected" from "able to publish".
  ACL rejections and firewall drops currently look identical to health.
- **Subscription liveness self-test.** Confirm each subscription is still
  receiving broker traffic, not merely that the socket is open.
- **Non-retained silence disambiguation.** An explicit "nothing has been
  published here since you started watching" state, so it is not confused
  with "the tool missed it". This one is cheap and removes a genuinely
  common misreading.

Effort: low to medium each. High trust value. Reviewers punish a tool
that lies about its state harder than one that lacks a feature.

### 5. Reject wildcard characters in publish topics

A Node-RED user published to a topic string containing `+` and `#`,
which is legal only in a subscribe filter. The broker dropped and
reconnected every MQTT node in the flow, which then replayed a flood of
retained messages on resubscribe. No error pointed at the cause. The
maintainer's response was that a check "should be in order", meaning no
client in the ecosystem guards this.

Validate and warn before sending. Trivial, and it prevents a failure mode
that looks completely unrelated to its cause.

Effort: trivial.

### 6. AsyncAPI 3.0 import for contract validation

AsyncAPI with MQTT bindings is the MQTT world's actual equivalent of
OpenAPI, and nobody has built the import path. Import the document,
pre-populate the topic tree with expected topics and payload schemas,
then flag live traffic that violates the contract.

This reframes the tool from "watch what happens" to "verify what happens
matches the design", which is the higher-value job and the one an
employer pays for.

Effort: medium to high.

### 7. Payload-keyed correlation

Round 1+2 has request and response correlation, but topic-keyed, on the
Zigbee2MQTT `bridge/request` and `bridge/response` model. Shelly Gen2
breaks that: every RPC request and response is multiplexed onto one
shared `<id>/rpc` topic pair and correlation is only possible by reading
the `src` and `id` fields inside the JSON body.

So correlation needs a configurable JSONPath key mode, not just topic
pairing. Same feature, wider contract.

Effort: small, if built into the correlation work rather than after it.

### 8. Subscription filter and ACL checker

MQTT Engine 5.0's "filtered namespace" setting silently leaks
`spBv1.0/STATE/...` through a filter that claims to exclude it. Found by
accident, worked around by disabling Primary Host rather than fixing it.

Feed the tool a filter or ACL rule plus a topic set and show matches
versus misses, so silent leaks surface before production. This is exactly
the wildcard tester I am shipping on the website, promoted to an in-app
feature, so the logic is written once.

Effort: low, given the website tool.

### 9. Protocol anomaly panel

Wireshark's Expert Information, for payload content rather than control
packets. Severity-coded running list of oddities: oversized payloads,
non-UTF8 bytes presented as text, QoS silently downgraded by the broker,
retained flag set on an empty payload, JSON that fails to parse despite a
content-type hint declaring it.

Distinct from round 3's control-packet trace, which is protocol level.
This is content level, and it finds problems the user would otherwise hit
by accident.

Effort: medium.

### 10. Exemplar linking, chart to raw messages

Click a spike on a chart, land on the exact messages in that time window
in the payload viewer. Grafana exemplars. Ties two features that already
exist and currently do not talk to each other, which makes it cheap.

Effort: medium, mostly plumbing.

### 11. Breakpoint and edit in flight

Pause an outgoing publish or an incoming message, edit the payload, then
release it. Charles and Proxyman and mitmproxy all have this and no MQTT
tool does.

Rated the single most unclaimed idea in the category. It needs a proxy or
bridging architecture to intercept mid-flight, so it is the expensive
one, but it is also the one that would get written about.

Effort: high. Park it, but keep it.

### 12. Smaller transplants worth keeping on the list

- **Derived and clickable pivot fields.** Extract a field (device ID,
  batch number) and make it a clickable pivot that filters the tree or
  history to everything sharing that value. Broader than correlation:
  works on any field.
- **Topic-tree health badges.** Inline decode-failure rate, malformed
  payload rate, silence beyond expected cadence. Glanceable triage.
- **Field-level payload masking.** Mark a JSONPath as sensitive so it
  renders redacted in the viewer and in exports. The use case is
  screen-sharing a debugging session, which engineers do constantly.
- **Subscribe-options inspector.** QoS granted versus requested, No
  Local, Retain As Published, Retain Handling. Subscribe-time, so
  distinct from the connect-time config gaps in round 3. Cheap.
- **Decode pipeline explain panel.** For one message, show which stage it
  passed through and where it fell through to raw bytes. Debugging aid
  for my own decode pipeline, which is about to get much more complex
  with stateful Sparkplug and per-topic binding.
- **Saved workspace and layout presets.** Named pane layout plus filter
  presets per broker, "flood triage", "Sparkplug decode".
- **Synced time scrubber** across tree, payload viewer and chart.
- **Command round-trip tracing** for NCMD and DCMD writes, showing where
  the write died. Cirrus Link's path can break at Transmission or Engine
  independently and nothing shows which.
- **macOS Shortcuts and Services integration.** EasyMQTT's Siri
  Shortcuts support draws specific, enthusiastic review praise, which
  suggests appetite for OS glue beyond a CLI companion.
- **Catch-up affordance.** Surface what arrived while the window was not
  focused. Asked for on mobile where the OS forbids it; on desktop it is
  merely unimplemented.
- **Cross-topic sequence correlation.** Meshtastic publishes the same
  event to a protobuf topic and a JSON topic; a user proved a dropped
  packet by hand-counting sequence numbers across both. Flag when one
  sibling advances without the other.

### 13. Retained provenance, folding into the retained manager

Recurring Home Assistant confusion: a user disables the retain flag on
the publisher, assumes it is fixed, and the broker keeps serving a stale
retained payload that predates the change. Some resort to deleting
`mosquitto.db`.

Not a new feature, a design requirement for the retained manager already
ranked tier 1: show retained-message **age and origin**, not merely
presence, so "this topic holds a retained message" reads differently from
"the last publisher had retain set".

## Marketing and positioning findings

- **Sharpen the Sparkplug claim.** Generic tools are not merely lacking,
  they are *actively wrong*. Sparkplug puts the last hierarchy segment in
  the payload, not the topic, so MQTT Explorer displays a misleading
  partial hierarchy and the user has no idea. MQTT.fx renders compressed
  garbage until you manually pick the decoder from a dropdown. "We show
  the reconstructed hierarchy correctly by default, competitors show you
  a wrong one" is a much stronger line than "we decode Sparkplug".
- **Launch-time network chatter reads as betrayal.** A MyMQTT reviewer
  objected to a cookie-consent dialog on a tool that talks to your own
  broker. Another had an update replace a working tool with a forced
  terms-of-service screen. The no-telemetry stance is worth stating
  loudly and visibly, not just in a policy page.
- **Config portability is a repeated mobile complaint** and a warning:
  IoT MQTT Panel users rebuild 20-plus widget layouts by hand per device,
  and upgrading free to Pro lost existing dashboards. Whatever paid tier
  I build must never lose the free tier's configuration.
- **Praise clusters on speed to first connection and TLS just working.**
  Those are table stakes, and broken TLS does not generate angry reviews,
  it generates silent abandonment.

## Website and distribution

### Error-code reference hub is the strongest content opportunity found

I checked four verbatim error strings. "Connection refused: Not
authorized" is held by a thin AI-generated stack-diagnosis page plus
forum threads. CONNACK 0x05 is GitHub issues and Microsoft Q&A. MQTT 5
reason code 135 has exactly one real competitor, EMQX Cloud's error-code
reference, which is broker-specific. TLS handshake failures are scattered
across Arm and Mbed forums with no consolidated page anywhere.

High intent, low competition, and it is the query a person types at the
exact moment they need a better client. A hub covering CONNACK 1 to 5,
the MQTT 5 reason codes, and the common TLS and certificate failures,
each with a real fix and a "diagnose this live" hook, should outrank what
is currently there. This is the next website build after the three tools
now in flight.

### Other website findings

- **Page per broker connection** (Mosquitto, EMQX, HiveMQ Cloud, AWS IoT
  Core, Azure IoT Hub, Adafruit IO, flespi) is viable. Vendor docs all
  target SDKs and devices; none show a desktop client's exact host, port,
  TLS and credential fields.
- **Page per device convention** cannot out-rank the official docs and
  should not try. Condensed cheat-sheet tables plus "here is what this
  looks like in the topic tree" competes against forum threads instead,
  which is winnable.
- **Missing comparison pages**: MQTTBox alternative (unmaintained tool,
  live alternatives demand) and a Node-RED comparison, which is the
  largest adjacent audience. mqttui, MQTT Studio and VSMqtt are too thin
  to bother with.
- **AlternativeTo listing is missing or under-voted.** On MQTT
  Explorer's alternatives page the top free listing is "Moqqa", not MQTT
  Viewer. Claiming that listing is one of the cheapest wins available.
- **Video is genuinely underserved.** No dedicated MQTT desktop client
  comparison or review video was found at all, and existing MQTT Explorer
  tutorials have unimpressive view counts.
- `sitemap.xml` still 404s, only `sitemap-index.xml` exists (round 3).

### Distribution policy, and one hard blocker

**Flathub banned AI-generated and AI-assisted submissions on 29 May
2026**, covering code, manifests, docs and even PR text, with rejection
without review and bans for repeat offenders. This confirms the earlier
decision to shelve Flathub. Any Flathub work must be hand-authored by me,
with no agent involvement at any stage.

Homebrew Cask accepts proprietary paid binaries and does not ban
AI-assisted PRs, but caps non-maintainers at one AI-assisted PR open at a
time, with a human required to handle all review comments. winget,
Chocolatey, Scoop and AUR all accept paid proprietary software with no
AI policy found. nixpkgs effectively cannot list a paid closed binary in
the cached channel.

`awesome-mqtt` does not list MQTT Viewer. Low-effort, high-relevance PR.

### Pricing

The desktop developer-tool cohort converges hard: **perpetual licence
plus one year of updates, keep using it forever after, 35 to 79 dollars
for an individual.** Proxyman 49 dollars, TablePlus 79, Charles 50,
Beyond Compare 35. Kaleidoscope moved a perpetual base to subscription
and took visible public backlash, which is the cautionary case against
ever doing that.

Free tier shape that works in this cohort is "free does the full everyday
job with no artificial caps, paid unlocks power-user and team features",
as Proxyman does with scripting and breakpoints behind the paywall. Not
"crippled until you pay".

Educational and open-source maintainer licences are a cheap goodwill and
distribution lever with an obvious fit to the hobbyist half of the
audience.

Stale copy to fix: the site still describes the product as "completely
free and open-source, no account required" in at least two places, which
contradicts a paid product. Round 1+2 flagged the same thing about
third-party summaries. Worth resolving before any pricing page ships.

## What I would do with this

Round 1+2 tier 1 still stands. From rounds 3 and 4, the cheap items that
should just get done alongside it: copy as code, wildcard validation on
publish, the subscribe-options inspector, the non-retained silence state,
and CSV export from round 3.

The three bets worth real planning, in order: the connection
truthfulness cluster, because it is trust and it keeps recurring
independently; snapshot diff feeding the GxP validation bundle, because
that is the only finding with a genuinely different price point attached;
and the MCP server from round 3, because it changes what the product is.

Website order: finish the three tools in flight, then the error-code
reference hub, then per-broker connection pages.
