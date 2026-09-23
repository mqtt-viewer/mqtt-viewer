# MCP server: build spec

Branch: `feat/mcp-server` → PR into `develop`.
Status: draft for my review. This is a bigger surface than most specs
here (new transport, new consent model, new audit trail); expect it to
land as several PRs behind the master toggle, not one.

## What and why

Expose MQTT Viewer itself as an MCP server, so Claude Code, Cursor, or
any MCP-capable agent can inspect and (opt-in) act on a live broker
through the app that is already running.

MQTTX embeds an MCP *client* so its own AI copilot can call out to a
model. Being an MCP *server* is the inverse, and nobody has done it.
It means no bundled model, no API keys, no model picker, no per-token
cost to me, and it works with whatever agent the user already pays
for. The standalone MCP servers that exist (`ezhuk/mqtt-mcp`,
`mqtt-ai/mcp-over-mqtt`) are bare protocol bridges: no UI, no codecs,
no history, no credential store. MQTT Viewer already holds all four,
and that is the moat: an agent gets protobuf and Sparkplug decode plus
bounded, budgeted history for free, on a broker it did not have to
configure separately.

The risk is symmetric with the opportunity. This is the first time
anything in the app lets an external, semi-autonomous process act on a
user's broker. A production broker is not a sandbox: a bad publish can
flip a real relay, and a compromised or confused agent is a genuine
threat model, not a hypothetical one. Most of this spec is the
consent and safety design, not the tool surface.

## Transport: local HTTP, not stdio

MCP's two mainstream transports are stdio (the client spawns the
server as a child process and talks over its stdin/stdout) and
Streamable HTTP (the server is a long-lived process, the client
connects to it over a loopback port).

Stdio does not fit here. MQTT Viewer is not a thing an agent spawns:
it is a GUI app the user already has running, holding live broker
connections, in-memory history, and decoders that took a real MQTT
session to build up. Stdio would mean either the agent launches a
second, headless copy of the app that has to reconnect to every broker
from scratch (defeating the entire point: reuse what is already live),
or somehow attaches to the running GUI's stdio, which does not exist
as an addressable channel from outside the process.

So: a local HTTP listener, bound to `127.0.0.1` only, speaking
Streamable HTTP. The listener starts only when the master toggle
(below) is on, and stops immediately when it is turned off. It is not
a background service; it lives and dies with the app window.

Loopback-only is necessary but not sufficient. A local HTTP port is
reachable by anything else running as the same user, including a
malicious web page via DNS rebinding (this is a known, publicly
reported issue class for local MCP servers, not a hypothetical). Two
mitigations that are cheap and standard for local HTTP servers apply
here:

- **Bearer token.** Generated once when the server is first enabled,
  stored alongside the port in settings, required on every request.
  The setup config snippet embeds it, so the user copy-pastes once.
- **Origin/Host validation.** Reject any request whose `Origin` header
  is present and not the expected agent client (i.e. reject anything
  that looks like it came from a browser tab), per the MCP spec's own
  guidance for local servers.

Neither of these is the real safety boundary, publish permission and
the allowlist are (see Safety below), but both are free and close off
the "a stray browser tab talks to my broker" class of problem.

## Tool surface

Seven tools for v1. Each is read-only unless stated. Every tool call
is checked against the allowlist and logged before it runs (see
Safety); the descriptions below are the tool's own behaviour once
authorised.

### `list_connections`

Lists connections exposed to MCP, i.e. only those with `mcpAllowed`
set (see Safety: a connection the user has not opted in is not
merely blocked, it does not appear at all).

Maps to `App.GetAllConnections()` (`backend/app/connections.go`),
filtered to the allowlist and stripped of credentials.

```jsonc
// input
{}
// output
{
  "connections": [
    {
      "connectionId": 3,
      "name": "plant-broker",
      "host": "10.0.4.12",
      "port": 8883,
      "protocol": "mqtts",
      "mqttVersion": "5",
      "isConnected": true,
      "publishAllowed": false,
      "subscriptionCount": 4
    }
  ]
}
```

### `list_topics`

Lists topics the connection has seen, most recently active first,
with an MQTT-filter pattern and cursor paging.

New backend work: nothing today returns a lightweight topic index.
`MessageHistory.GetAllHistory()` (`backend/mqtt/history.go`) exists
but copies every retained message's full payload per topic, used
today only for file export (`backend/app/export.go`) where that cost
is a one-off. This needs a new, cheap `MessageHistory.GetTopics()`
that returns topic, last-arrival time, retain flag and byte size
without copying payloads, plus a new `App.ListTopics(connId, pattern,
cursor, limit)` wrapper. Pattern matching reuses the existing MQTT
wildcard matcher (`util.RouteMatchesTopic`, already used by
`topic-matching.SubscriptionMatcher`) so `pattern` accepts the same
`+`/`#` syntax as a subscription filter, not a new glob dialect.

```jsonc
// input
{ "connectionId": 3, "pattern": "factory/line1/#", "cursor": null, "limit": 100 }
// output
{
  "topics": [
    { "topic": "factory/line1/status", "lastSeenMs": 1753875600123,
      "retain": false, "payloadSizeBytes": 89 }
  ],
  "nextCursor": null
}
```

### `get_topic_value`

Returns the latest message on a topic.

Maps to `App.GetMessageHistory(connId, topic)`
(`backend/app/mqtt.go:85`), which already falls back to the last
retained value if the message has aged out of the in-memory window;
the tool takes only the newest entry. Payload is capped (see Paging
and payload limits) and flagged `truncated` if cut. `decoded` mirrors
the existing `IsDecodedProto` middleware property
(`backend/mqtt-middleware/protobuf_decode.go`) so the agent knows
whether it is looking at raw bytes or a protobuf/Sparkplug decode.

```jsonc
// input
{ "connectionId": 3, "topic": "factory/line1/status" }
// output
{
  "topic": "factory/line1/status", "found": true,
  "payload": "{\"state\":\"running\"}", "qos": 1, "retain": true,
  "timeMs": 1753875600123, "decoded": false,
  "truncated": false, "payloadSizeBytes": 20
}
```

### `subscribe_and_wait`

Blocks (up to a timeout) for the next message matching a topic
filter, for one-shot "trigger the thing, confirm it happened" agent
workflows.

No backend equivalent exists. MQTT semantics mean messages only flow
for filters something has already subscribed to
(`backend/mqtt/subscribe.go`); v1 restricts this tool to filters
already covered by an existing subscription
(`SubscriptionMatcher.GetMatchingSubscription`,
`backend/topic-matching/matches_subscription.go`) rather than letting
an agent create a new broker-side subscription on demand, which I
want to keep as a deliberate, visible user action for now (see Open
questions). New backend piece: `MqttManager.receiveMessage`
(`backend/mqtt/receive.go`) has no hook for a one-shot waiter today;
it needs a small registry of `(topicFilter, resultChan)` that
`receiveMessage` checks after adding to history, independent of the
300ms buffer drain so wait latency isn't bounded by that interval.

`payloadContains` is a plain substring check only, never a regex:
letting an agent hand a broker-derived or agent-generated pattern
straight into a regex engine is a ReDoS surface for no real benefit
here.

```jsonc
// input
{ "connectionId": 3, "topicFilter": "factory/line1/status",
  "payloadContains": "\"state\":\"stopped\"", "timeoutMs": 5000 }
// output
{ "matched": true, "timedOut": false,
  "message": { "topic": "factory/line1/status",
    "payload": "{\"state\":\"stopped\"}", "qos": 1, "retain": false,
    "timeMs": 1753875612001 } }
```

### `publish`

Publishes a message. Requires the connection's separate
`publishAllowed` flag, not just `mcpAllowed` (see Safety). Rate
limited harder than the read tools.

Maps to `App.PublishMqtt(connId, PublishParams)`
(`backend/app/mqtt.go:150`). Worth flagging explicitly in the tool
description handed to the client: an empty payload with `retain:
true` deletes that topic's retained value broker-wide, for every
client, not just this one, exactly the mechanism
`App.DeleteRetainedMessage` already uses. An agent with publish
permission can already do this; the tool description should say so in
as many words, mirroring the confirm-dialog language in
`docs/specs/research/retained-message-manager.md`.

```jsonc
// input
{ "connectionId": 3, "topic": "factory/line1/cmd", "qos": 1,
  "payload": "{\"cmd\":\"restart\"}", "retain": false }
// output
{ "published": true }
```

### `query_history`

Pages through durable (disk-recorded) history for a topic, for "what
happened over the last hour" questions that outlive the in-memory
window.

Maps to `App.GetReceivedMessageWindow(connectionID, topic, beforeID,
afterID, limit)` (`backend/app/received_messages_read.go:22`), which
already does keyset pagination. Requires recording to be enabled
(`AppSettings.RecordingEnabled`); if it is off, the tool returns a
clear error rather than a silently empty page, recording-on is its
own explicit opt-in already and MCP should not flip it implicitly.
`limit` is capped far below the UI's own default window
(`DefaultReceivedMessageWindow = 5000`), see Paging below.

```jsonc
// input
{ "connectionId": 3, "topic": "factory/line1/status",
  "cursor": null, "limit": 50 }
// output
{
  "messages": [ { "id": 88231, "topic": "factory/line1/status",
    "payload": "...", "timeMs": 1753872000000 } ],
  "nextCursor": 88182, "hasMore": true
}
```

### `get_broker_status`

Connection state plus traffic counters and, where available, decoded
`$SYS` metrics, the same data the detached broker-status window shows
(`App.OpenBrokerStatusWindow`, `backend/app/windows.go:128`).

Maps to `App.GetMqttStats()` (`backend/app/stats.go`) for
`ConnectionStats` (messages/bytes sent and received) plus
`App.GetSysMessageHistory(connId)` (`backend/app/mqtt.go:100`) for the
raw `$SYS/#` retained set.

```jsonc
// input
{ "connectionId": 3 }
// output
{
  "isConnected": true, "mqttVersion": "5",
  "messagesReceived": 48221, "messagesSent": 12,
  "bytesReceived": 991823, "bytesSent": 340,
  "sysMetrics": { "$SYS/broker/clients/connected": "14" }
}
```

### Not in v1: `get_sparkplug_state`

On the starting list, cut for now. `docs/specs/research/
stateful-sparkplug-decode.md` is itself an unimplemented research
spec, there is no `backend/sparkplug/` package to read state from
(verified: the directory does not exist). Sparkplug decode today is
stateless, per-message (`ProtoDecodeMiddleware`), so an agent can
already inspect individual Sparkplug payloads via `get_topic_value`
and `list_topics`, aliases unresolved. `get_sparkplug_state` becomes a
v2 tool once (if) the session-store spec lands, at which point it
maps directly to that spec's proposed `SessionStore`.

## Safety and consent

This is the part that has to be right; everything above is ordinary
service-layer work by comparison.

**Master toggle, default off.** A new "MCP server" section in the
existing app-wide settings dialog (`frontend/src/components/
SettingsDialog`). Off means the HTTP listener is not running, full
stop, not just "tools return errors."

**Read-only by default, publish is a separate opt-in.** Two new
booleans on `models.Connection` (`backend/models/models.go`),
alongside the existing per-connection flags like `IsProtoEnabled` and
`IsCertsEnabled`, which are the right precedent for this: an explicit,
visible, per-connection tick, not a global switch.

- `McpAllowed`: this connection is visible to MCP tools at all.
  Default false. Lives in the same connection-details form
  (`frontend/src/views/Connection/ConnectionDetailsView/components/
  ConnectionForm`) as the other per-connection toggles.
- `McpPublishAllowed`: this connection additionally accepts
  `publish` calls. Default false, and only meaningful (and only shown
  in the UI) once `McpAllowed` is on. Two separate ticks, not one
  tick plus a checkbox that appears, so publish is never a single
  misclick away from read-only.

A connection with `McpAllowed` off does not appear in
`list_connections` at all, and every other tool rejects an
unrecognised or unauthorised `connectionId` with the same "not found"
shape it would give for a genuinely missing one. An agent probing for
what it can see should learn nothing more than "that connection isn't
exposed."

**Visible indicator.** Two layers, because "the toggle is on" and
"an agent is calling right now" are different facts a user needs:

- *Ambient*: whenever the master toggle is on and at least one
  connection is allowlisted, a small persistent badge sits in the
  main window's header, next to the connection tabs. It reads
  something like "MCP on · 1 connection". Clicking it jumps straight
  to the settings section to revoke.
- *Live*: while a tool call is actually in flight, that badge pulses
  and briefly names the tool ("MCP · list_topics"). This matters
  because the ambient badge alone would not tell a user *when*
  something happened, only that it's possible; the audit log covers
  the after-the-fact record.

Because the app can be minimised or closed to tray while an agent
works, the ambient badge in the window is not enough on its own; see
Open questions on whether it also needs an OS-level (tray icon)
counterpart.

**Audit log.** Every tool call, authorised or rejected, is recorded:
new `McpToolCall` GORM model (`backend/models/models.go`, registered
in `loader/main.go`, migrated via `just new-migration mcp-server` per
the usual convention) with connection ID, tool name, a truncated/
redacted argument summary, result summary, duration, the MCP client's
self-reported name if given, and any error. Pruned the same way
received messages are (count or age cap, `backend/app/
received_messages_prune.go` is the existing pattern), so it does not
grow unbounded. Surfaced as a plain, most-recent-first list in the
same settings section, exportable to JSON via the existing
`saveMessagesToFile`-style dialog pattern (`backend/app/export.go`).

**Rate limits.** Per connection, separate budgets for reads and
publishes (publishes much tighter), plus a hard cap on concurrent
`subscribe_and_wait` waiters so an agent cannot park an unbounded
number of goroutines by issuing many long waits at once. Exact
numbers are an implementation detail, not a design decision, but the
shape is: generous enough that a legitimate debugging session never
notices, tight enough that a runaway loop or a compromised agent
cannot flood the broker before a human notices the indicator.

**Untrusted content, both directions.** Tool *descriptions* handed to
the MCP client are static text I write, never derived from broker
data, so that specific injection vector does not exist. Tool
*results* are a different story: topic names and payloads come
straight from the broker, and on anything less trusted than a private
LAN (test.mosquitto.org is a named core use case in this app) a
malicious publisher can put arbitrary text, including
prompt-injection attempts, into a payload that lands back in the
agent's context. This cannot be fully engineered away; the mitigation
is architectural rather than textual: the tool *descriptions*
themselves should say plainly that payload content is untrusted
external data, and, more importantly, the thing that actually bounds
the damage is that `publish` needs its own opt-in, is rate limited,
and is audited, so an agent that gets confused by injected text still
cannot act on a connection the user has not separately allowed it to
write to.

## Discovery and setup

Settings dialog, MCP section: toggle, the current port (auto-chosen
once from a small fixed range on first enable and then persisted, so
the URL in a client's config stays stable across restarts, new
`McpPort` column on `AppSettings`), the bearer token (shown once,
regenerable), and a "copy config" button that renders the exact
snippet with the live port and token substituted, plus a link out to
each allowlisted connection's settings for the per-connection
toggles.

Claude Code CLI:

```sh
claude mcp add --transport http mqtt-viewer \
  http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
```

Cursor / other JSON-config clients:

```jsonc
{
  "mcpServers": {
    "mqtt-viewer": {
      "url": "http://127.0.0.1:<port>/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Paging and payload limits

An agent's context is a much scarcer resource than a human's screen,
so every limit here is tighter than the equivalent UI default:

- `list_topics`: page size capped server-side (proposed 200) even if
  a client asks for more; cursor-based, not offset, so a churning
  topic tree doesn't skip or duplicate entries across pages.
- `get_topic_value` / `subscribe_and_wait`: payload capped (proposed
  8 KB) with `truncated: true` and the real `payloadSizeBytes` always
  returned, so the agent knows to reach for `query_history` with
  explicit paging instead of assuming it saw the whole thing.
- `query_history`: capped far below the UI's own
  `DefaultReceivedMessageWindow` of 5000 (proposed default 50, hard
  max 200). This is a durable, disk-backed query, so a wide-open
  limit here is the easiest way to blow an agent's context in one
  call.
- Binary payloads: `MqttMessage.Payload` is `[]byte`, which the
  existing Go JSON marshalling already base64-encodes; the size cap
  applies to the raw byte count, not the inflated base64 string, so a
  5 MB image payload is rejected/truncated on its real size.

## Out of scope for v1

- Ad hoc subscriptions from `subscribe_and_wait`. It only waits on
  filters an existing subscription already covers; see Open questions.
- `get_sparkplug_state` (blocked on the stateful Sparkplug decode spec
  landing first).
- Editing connections, subscriptions, or app settings via MCP tools.
  This feature is for debugging a broker, not reconfiguring the app;
  every mutating tool is scoped to broker traffic (`publish`), not to
  MQTT Viewer's own state.
- Non-loopback transport of any kind (no relay, no tunnel, no remote
  pairing). Staying local is part of the safety story, not just an
  implementation shortcut.
- Multi-session management UI. If two MCP clients attach at once in
  v1, both share the one listener; they are distinguished in the
  audit log by self-reported client name only.
- A deep-scan style "sweep the whole topic namespace" tool. `list_topics`
  only surfaces what the app has already seen via its own
  subscriptions, mirroring the same constraint the retained-message
  manager spec (`retained-message-manager.md`) documents for MQTT
  itself: there is no broker-side "list everything" operation.

## Adjacent opportunity: decoding MCP-over-MQTT traffic

Worth naming as a follow-on, not part of this spec. EMQX and
`mqtt-ai/mcp-over-mqtt` are pushing MQTT itself as an MCP transport,
JSON-RPC MCP messages carried over structured topics rather than
HTTP. If that catches on, MCP traffic becomes exactly the kind of
opaque wire format this app already exists to decode: a future
feature would add a topic-grammar detector for the mcp-over-mqtt
topic conventions (the same shape as `topic-matching/
matches_sparkplug.go`), then a request/response session view pairing
JSON-RPC calls by id and surfacing tool names, essentially the
Sparkplug tree view's structure applied to a different structured
payload. Separate spec, only worth doing once the transport has real
adoption to point at.

## Open questions

1. Port: fixed default constant with a probe-and-persist fallback if
   taken, or always probe a range? I lean fixed default (simpler
   config snippet, one less moving part) with the probe only as a
   fallback.
2. Bearer token: always required, or an option to disable it for
   users who are confident in their machine's isolation? I lean
   always-on, it's a one-time copy-paste and the DNS-rebinding class
   of attack is real.
3. Indicator: window header badge only, or also an OS tray icon so it
   is visible while the window is minimised or closed to tray? The
   app can plausibly be backgrounded while an agent is mid-session,
   which argues for tray.
4. `subscribe_and_wait` scope: restricted to existing subscriptions
   (v1, as specced) or allow the tool to create a temporary
   subscription on demand (more capable, but a subscription created
   silently by an agent is a new kind of side effect I'd want its own
   indicator for)?
5. Should enabling MCP for a connection that has disk recording off
   nudge the user to turn recording on (so `query_history` is useful),
   or stay fully separate as specced? Leaning separate: recording is
   already its own considered opt-in elsewhere in the app.
6. Cap MCP to one active client at a time for a simpler mental model
   ("who can see my broker right now" has one answer), or allow
   several concurrently as specced? Leaning allow several, since the
   allowlist and audit log are the real controls either way.
