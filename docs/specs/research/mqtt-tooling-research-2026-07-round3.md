# MQTT tooling research, round 3 delta (July 2026)

Compiled 2026-07-30 from five parallel research passes: internal feature
inventory, competitor sweep, competitor-tracker demand mining, own
tracker audit, and a website/SEO pass.

This is a **delta document**. Round 1+2 lives in
`mqtt-tooling-research-2026-07.md` and its 16-item ranking still holds.
Everything already ranked there is deliberately omitted here. What
follows is only what that doc does not contain.

Two things shape the delta. First, the competitor demand mining largely
re-confirmed round 1+2 rather than adding to it, which is a good sign
about that doc. Second, the website was never in scope before, and it is
the single largest untouched surface I found.

## Corrections and confirmations to round 1+2

- Retained-message bulk management, ranked tier 1 #1, has **no** direct
  feature request in any competitor tracker. The only evidence is vendor
  docs on clearing one topic at a time. It remains the right bet on
  first principles (HA ghost configs, Z2M availability, Sparkplug
  retained births) but it is a bet, not validated demand. Worth knowing
  before sizing the marketing around it.
- Team sharing, floated as a premium tier, has zero hits across MQTTX
  for team/share/sync/collaborate. Own Discussion #3 goes further: the
  commenters explicitly preferred local export/import to cloud
  workspaces. Treat cloud sync as dead and git-friendly export (tier 2
  #8) as its replacement.
- In-app charting demand is near zero in competitor trackers. The only
  ask is CSV export of plotted values. Charting is a retention feature,
  not an acquisition one.
- Perf-under-flood and signed-native-builds moats are strongly
  re-confirmed. Explorer's Apple Silicon "damaged app" cluster is seven
  open issues totalling roughly 77 reactions, larger than any feature
  request in that tracker, and #885 "looking for maintainer" has 34
  comments. Continuity anxiety is a real buying signal.
- TLS and certificate handling is the highest single-issue engagement
  anywhere I looked (Explorer #596: 15 reactions, 25 comments, on a
  Let's Encrypt root rotation producing no actionable error). Round 1+2
  treats TLS as a fixed cluster. It is an ongoing bar, not a closed one.

## New ideas, ranked

### 1. Expose MQTT Viewer as an MCP server

Round 1+2 ranks "AI copilot" tier 3 #13 and dismisses it on weak
utility signal. I agree with that call, and this is the opposite play.

Do not embed a model. Expose the running app's session as MCP tools:
list topics, read last payload, subscribe and wait for a match, publish,
query recorded history, read the decoded Sparkplug session state. Then
Claude Code, Cursor, or any agent debugs the user's live broker through
MQTT Viewer.

Why it is different from what MQTTX shipped: MQTTX 1.12 embeds an MCP
*client* so its own copilot can call out. Being an MCP *server* means no
model picker, no API keys, no per-token cost to me, no prompt
maintenance, and it works with whatever tool the user already pays for.
The standalone alternatives (`ezhuk/mqtt-mcp`, `mqtt-ai/mcp-over-mqtt`)
are bare servers with no UI, no codecs, no history, no credential store.
The app already holds all four, which is the moat: the agent gets
protobuf and Sparkplug decode and bounded history for free.

Adjacent and worth a look separately: MCP-over-MQTT is emerging as a
transport, so MCP traffic becomes a thing that needs debugging. Being
the tool that decodes it is a small, well-timed content and feature
play.

Effort: medium. Sizeable strategic upside, and it is the only idea here
that changes what the product *is*.

### 2. Query layer over recorded history

Opt-in SQLite recording with a disk budget already exists. Nothing sits
on top of it but windowed scrollback.

Add a query surface: topic pattern plus time range plus a payload
predicate (JSONPath or a small expression language), returning a result
table that can be charted or exported. Saved queries per connection.

Demand is real but nobody has framed it as querying. Explorer #632
"data logger" has 5 reactions and 11 comments with no agreement on
format, which is raw demand to persist and then *do something* with a
session. #388 and #523 want bulk history export and note that even
Cmd+C does not work. mqttui #159 and #194 want CSV or clipboard export.
Round 1+2 lists #632 in a bullet but never ranks an analysis surface.

This converts recording from insurance into the reason to record. No
competitor has anything like it.

Effort: medium. The storage half is done.

### 3. Record and replay into a broker

Round 1+2 ranks an in-app simulator and bench harness at tier 3 #13,
which is synthetic traffic generation. Replaying a *captured real
session* into a different broker is a different capability: reproduce a
field fault on a bench broker, regression-test a subscriber against
yesterday's traffic, soak-test staging with production shapes.

The evidence here is unusual and I think it is the strongest signal in
this whole round. Nobody asks a GUI client for this, because an entire
parallel ecosystem of standalone CLIs already exists for it:
`mqtt-record-replay`, `mqtt-recorder`, `mqtt-stresser`, `mq-hammer`,
`freenowtech/mqtt-loadtest`. Users did not file requests, they left.
Absence of demand in trackers is not absence of demand.

Effort: small to medium, given recording exists. Speed controls, topic
remapping, and loop are the whole feature.

### 4. Broker and snapshot diff

No tool in the sweep does this. Take two topic-tree snapshots, either
two live connections or one connection at two times, and diff them:
topics that appeared, disappeared, changed value, changed retained
status, changed type.

Uses: staging versus production parity, before and after a deploy or
firmware roll, device inventory drift during commissioning, HA migration
verification. Round 1+2 covers per-message diff, which already ships,
but not tree-level diff.

Builds directly on the retained-tracking index from PR #121, so it wants
to land after that.

Effort: medium. Genuinely novel, and it demos well.

### 5. Watch expressions and silence alerts

Define a watch: notify when a topic matches a predicate, or, more
usefully, when a topic goes **silent** for N seconds. Desktop
notification plus an entry in a watch panel.

Silence is the point. Stale-device detection is the loudest recurring
pain in both the home-automation and industrial passes, and round 1+2's
availability/LWT dashboard (tier 3 #15) is the passive read of it. An
active watch makes the app useful while you are not looking at it, which
is exactly the soak-test and overnight-run case.

Effort: small to medium.

### 6. Protocol-completeness gaps in the connection form

The inventory turned up a cluster the roadmap never lists, and it
matters because the users' actual job is testing *device and broker*
behaviour:

- No last will and testament configuration at all. You can watch other
  clients' LWT but cannot set your own, so you cannot test how a
  subscriber reacts to a device dropping.
- Clean start is hardcoded true. No persistent session, so no way to
  test queued QoS 1 and 2 delivery to an offline client.
- Keep-alive is fixed (30s v3, 20s v5) and not exposed, so timeout
  behaviour cannot be exercised.
- No proxy support. MQTTX #706 (5 reactions) and Explorer #617.
- No TLS version pinning, no PSK, no OS trust store. MQTTX #1633, #915,
  #1548.

Framed together this is "the client that can reproduce any broker or
device edge case", which fits the debugging-tool positioning better than
any single item does. The first three are cheap.

Effort: small each. Good filler work between larger features.

### 7. CSV export and copy that works

JSON is the only export today. CSV is asked for across three separate
trackers: Explorer #497 (plotted values), #388 and #523 (bulk history,
including plain clipboard copy being broken), mqttui #159 and #194.
Round 1+2 mentions #497 in a list and never ranks it.

Cheap, and it is the kind of gap a reviewer notices.

Effort: small.

### 8. Command palette and global shortcuts

There is no global keyboard-shortcut system and no command palette. Only
local Enter and Escape handling in inputs and menus.

mqttui's entire existence is keyboard speed, and it holds roughly 700
stars on that alone. For a tool positioned as developer tooling density,
this is the cheapest available credibility.

Effort: small to medium.

### 9. Localisation

No i18n. MQTTX ships multi-language and has active Chinese-language
issue threads (#2034), so a substantial non-English user base exists for
this category and currently has one obvious choice. Compounds with the
website, since localised tool pages are their own search surface.

Effort: medium, and it is a permanent tax on every string thereafter.
Worth deciding deliberately rather than drifting into.

## The website is the biggest untouched surface

`mqttviewer.app` has 13 pages of static marketing and reference copy,
`/best-mqtt-clients/` already ranks, and there are **zero interactive
tools**. The `seo/` folder is an entity and AI-answer-engine playbook,
which is the right thesis, and single-purpose tools are the best link
and citation magnets available to it. Everything below is client-side
Astro plus Svelte islands, so no backend, and the local-only privacy
claim stays intact.

Ranked by demand over effort:

1. **Sparkplug B decoder.** Paste hex or base64, decode against Tahu.
   Near-zero tool competition on that query: the top results are docs
   and one video. It also showcases the exact differentiator I am
   building tier 1 #2 around, and the Go codec logic ports to
   protobufjs.
2. **Topic wildcard tester.** Pattern plus sample topics, live match
   highlighting. Real query volume owned entirely by prose articles from
   HiveMQ, EMQX, and Cedalo. No interactive tool exists. Trivial to
   build.
3. **HA discovery payload validator.** Paste a discovery config, flag
   non-retained configs and common mistakes, explain ghost configs.
   Targets the loudest hobbyist pain, extends the existing
   `/use-cases/home-assistant-mqtt` page, and pre-sells the discovery
   browser from round 1+2 tier 1 #4.
4. **MQTT cheat sheet.** QoS, packet types, wildcards, ports, retained,
   LWT, v5 properties, on one linkable page. Incumbents are dated PDFs
   on Cheatography and similar. Easy to out-design.
5. **Payload decoder.** Base64, hex, JSON, protobuf with a supplied
   schema. Only scoi.io competes. Generalises idea 1.
6. **QoS visualiser.** Interactive walkthrough of the 0, 1, and 2
   handshakes. An entire content cluster exists on this query and every
   result is a static diagram.
7. **Public broker directory.** Curated table with ports, TLS, WS, and a
   last-verified date. Existing roundups are stale and ad-heavy, so
   freshness alone wins, and one-click connect links funnel directly.
8. **ESP32 connection-code generator.** Form to PubSubClient snippet.
   Extends the existing ESP32 use-case page, and the user immediately
   needs a client to verify what it produced.

Also worth doing: `/compare` becomes a filterable matrix rather than a
static table, and the glossary gets anchor links per term plus a related
tool callout, making it the internal linking hub for the tools above.

One defect found: `sitemap.xml` 404s. Only `/sitemap-index.xml` exists.
Worth a redirect in case anything references the wrong path.

## Suggested sequencing against round 1+2

Round 1+2 tier 1 stands unchanged. I would slot from this document:

- Alongside tier 1, because they are cheap and independent: CSV export
  (7), the LWT, clean-start, and keep-alive controls (6), and two or
  three website tools (the Sparkplug decoder and wildcard tester in
  particular, since the decoder markets tier 1 #2 while I build it).
- Immediately after PR #121 lands: broker and snapshot diff (4).
- As the next strategic bet after tier 1: the MCP server (1), then the
  history query layer (2) and replay (3), which share plumbing and
  together make recording the reason to buy.
- Deliberate decision needed, not drift: localisation (9).
