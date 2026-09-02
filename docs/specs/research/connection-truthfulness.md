# Connection truthfulness — build spec

Branch: `feat/connection-truthfulness` → PR into `develop`. Likely lands as
several smaller PRs (one per sub-feature) rather than one branch; each
section below is independently shippable.

## What and why

The app currently tells the truth about one thing: whether the socket is
up. It has nothing to say about whether that socket is *useful*. Four
unrelated bug reports turned out to be the same failure mode:

- A Frigate user had `frigate/available` reporting online, the UI working,
  and zero messages arriving on `frigate/reviews`. Default logs said
  nothing; the only way to find it was editing the device's own log config,
  which turned up firewall errors. Socket up, traffic silently dropped.
- openHAB users run `mosquitto_sub` in a second terminal purely to prove
  traffic is reaching the broker, because the binding goes stale silently
  while TCP stays up.
- An EasyMQTT App Store reviewer reports the live feed silently stopping
  until force quit.
- Users cannot tell "this topic has published nothing since I started
  watching" from "the tool missed it". Silence is always ambiguous.

My own PR #141 (`fix(mqtt): reconnect when a v5 broker goes silent`) is
this same bug, in this app: `PingerV5` sent PINGREQ forever and never
checked for a PINGRESP timeout, so a broker that vanished without closing
the socket left the client reporting "connected" indefinitely. That fix
closed the transport-liveness gap. This spec is the rest of it: connected
does not mean publishable, subscribed does not mean receiving, and silence
does not mean broken. Treat "the app must not claim more than it knows" as
a standing product principle, not a one-off fix.

## The health model

Four sub-features, one vocabulary, so the UI doesn't grow four unrelated
badges. `ConnectionState` (`backend/mqtt/enums.go`) stays exactly as it is
— disconnected / connecting / connected / reconnecting is a fact, not an
opinion, and PR #141 already made it honest. What's missing is a second,
orthogonal axis that only applies while `connected`: whether the
connection is worth trusting right now.

```
type ConnectionHealth string

const (
    HealthUnknown  ConnectionHealth = "unknown"  // no signal yet (just connected, canary/liveness still warming up)
    HealthHealthy  ConnectionHealth = "healthy"  // every active signal is positive
    HealthDegraded ConnectionHealth = "degraded" // at least one concrete negative signal
)
```

Only two of the four sub-features produce an ongoing health signal:

- **Publish canary** (1) contributes "last publish was rejected" /
  "loopback probe failed" — sticky until the next successful publish or
  probe clears it.
- **Subscription liveness** (2) contributes "a subscription with an
  established cadence has gone quiet" — sticky until traffic resumes.

The other two are point-in-time UI clarifications, not health signals, and
must never touch this state:

- **Non-retained silence disambiguation** (3) is the *absence* of an
  alarm. It only changes copy in an empty state, never a colour.
- **Reject wildcard publish topics** (4) is input validation on a form
  field. It never reaches a connected, healthy session.

Rules to avoid alarm fatigue, binding on all of the below:

- `degraded` requires a concrete, named cause. There is no "vibes" red
  state. Every degraded transition carries a reason string a tooltip or
  log line can show verbatim.
- `degraded` is sticky but self-clearing: it reverts the moment the signal
  that caused it recovers (next successful publish, next message on a
  previously-stale subscription). No manual dismiss, no accumulating
  history of past problems on the live indicator.
- `unknown` is silent, not alarming. A connection that just came up, or a
  subscription still building its cadence baseline, shows exactly what it
  shows today — nothing extra — until it has enough signal to say
  something.
- One connection, one health value. Health is per-connection, not
  per-subscription, in the surfaces that read at a glance (status circle,
  latency chip). Per-subscription detail lives one level down, in the
  tooltip and the log viewer, where the user has already asked for detail.

### Where it surfaces

- **`ConnectionStatusCircle`** (`frontend/src/components/ConnectionStatusCircle/ConnectionStatusCircle.svelte`):
  today it's `state` in → a coloured, pulsing dot (`bg-success` /
  `bg-warning` / `bg-error`, keyed off `ConnectionState`). Add an optional
  `health` prop: `connected` + `healthy` renders exactly as today (no
  change for the common case); `connected` + `degraded` stops the pulse
  and swaps to a muted amber ring rather than a second red, so it reads as
  "pay attention" without competing with the actual-disconnected error
  colour. `unknown` renders identically to `healthy` — it is not a state
  worth drawing.
- **Sidebar latency chip** (`frontend/src/views/Connection/DataView/components/Sidebar/components/SidebarTopBar.svelte`,
  the `{connection.latencyMs} ms` + dot block at L38-45): this is the
  closest thing this app has to a "bottom bar" today — a compact,
  always-visible connection summary next to the connect toggle. Wrap it in
  a `Tooltip` (already used elsewhere in this file) that, when degraded,
  names the cause: `"Last publish rejected: not authorized"` or `"2
  subscriptions haven't reported in a while"`. No tooltip content, no
  visual change, when healthy.
- **Client log viewer** (PR #104, currently on `feat/client-logs`, not yet
  merged — `backend/mqtt/log_store.go`'s `LogStore`, surfaced by
  `ConnectionLogsDialog.svelte`): this is where the actual explanation
  belongs. `LogStore` already promises "always-on lifecycle/error lines...
  the dialog is never empty" for connect/reconnect/disconnect/subscribe.
  Extend the same always-on (non-debug-gated) line set with three new
  kinds, each written as a plain `LogEntry` at `LogLevelWarn` or
  `LogLevelError`: a rejected PUBACK (topic + reason), a failed canary
  round trip, and a subscription liveness transition (stale / recovered).
  These are exactly the sentence a user opens this dialog hoping to find.
  If #104 is still unmerged when this work starts, land these hooks in
  the same log-store PR rather than inventing a second logging path.

## 1. Publish canary

### Behaviour

Distinguish "connected" from "actually able to publish here." The
distinction only exists for QoS 1/2: MQTT's PUBACK reason code is the one
protocol-level signal a broker has for "I heard you, and no." QoS 0 is
fire-and-forget by design — there is no packet the broker sends back, on
either protocol version, and no clever probing changes that. Be explicit
about it in the UI rather than pretending.

**MQTT 5** already gives PUBACK/PUBREC reason codes, and the paho library
already treats `ReasonCode >= 0x80` as a Go error
(`paho@v0.22.0/client.go:928-931`, confirmed against the vendored module).
So `mm.publishV5` (`backend/mqtt/publish.go:74-122`) already surfaces a
rejected QoS 1 publish as a returned error today — the gap is that it's
discarded structure, not a missing capability:

```go
// backend/mqtt/publish.go:108
_, err := mm.connection.v5Connection.Publish(timeout, &paho.Publish{...})
```

The `*paho.PublishResponse` (has `ReasonCode byte` and
`Properties.ReasonString`) is thrown away. The caller gets a stringified
`"error publishing: not authorized"` with no code to branch on, so the
frontend can't distinguish "ACL rejection" (`0x87` `Not authorized`) from
"bad topic" (`0x90` `Topic name invalid`) from a plain network timeout.

**MQTT 3.1.1** has none of this. No reason codes exist in the protocol.
`mm.publishV3` (`backend/mqtt/publish.go:58-72`) already does the one
thing v3 *can* do: waits up to 2s for a PUBACK and errors on timeout,
which catches a broker that silently drops the publish without
disconnecting. It does not catch, and cannot catch, a broker that
disconnects the client instead (common ACL-enforcement pattern) — that
surfaces as a reconnect, decoupled from the publish action that caused it.
State this limitation in the UI copy rather than implying v3 knows why.

### Backend design

- New result type in `backend/mqtt/publish.go`, returned alongside the
  existing `error`:

  ```go
  type PublishOutcome struct {
      Acknowledged bool    // true once a PUBACK/PUBCOMP was received (QoS 1/2 only)
      ReasonCode   *byte   // v5 only; nil on v3 or QoS 0 (protocol has none)
      ReasonText   string  // human string from paho's Reason(), when available
  }
  ```

  Change `MqttManager.Publish` to `(PublishOutcome, error)`. `publishV5`
  keeps the `*paho.PublishResponse` instead of discarding it and copies
  `ReasonCode`/reason string across. `publishV3` sets `Acknowledged` from
  whether `WaitTimeout` returned true; `ReasonCode` stays nil, always —
  never synthesise one.
- `backend/app/mqtt.go`'s `PublishMqtt` returns the outcome to the
  frontend (new bound method return shape); regenerate bindings.
- Frontend: `publish-details.ts`'s `publish()` (currently only checks
  `!storeVals.topic`) surfaces the outcome next to the Publish button —
  inline, not a toast, since it's specific to the message just sent. For
  QoS 0, show a neutral (not red) "not confirmed — QoS 0 isn't
  acknowledged" note rather than silence, so a user who assumed QoS 0
  proves delivery is corrected once, gently, not on every send.
- Feeds `ConnectionHealth`: a rejected QoS 1/2 publish (`ReasonCode !=
  nil`, or v3 `Acknowledged == false`) sets `degraded` with the topic and
  reason as the cause. Clears on the next successful acknowledged publish.
  A QoS 0 publish never touches health — there's nothing to conclude from
  it either way.

### Optional loopback probe

A periodic (idle) publish+subscribe round trip to a private scratch
topic, e.g. `mqttviewer/_canary/<clientId>`, timing the trip and proving
the general publish/subscribe path works even when the user hasn't
published anything. Design honestly, don't oversell it:

- It proves "publish and subscribe to *some* topic works right now," not
  "your configured topics are allowed." ACLs are typically topic-scoped
  (mosquitto ACL files, EMQX rules); a passing canary says nothing about
  whether `factory/line1/status` specifically is permitted, and a failing
  canary on a deny-by-default broker says nothing about topics that are
  explicitly allow-listed. Label it as a floor check, not a guarantee, in
  whatever tooltip/log line reports it.
- Canary traffic must never reach a user-visible store, unlike real
  messages. It needs its own ephemeral subscription (same pattern as the
  retained-message-manager spec's deep scan — an additional subscribe on
  the existing connection, filtered out of
  `MessageHistory`/`MessageBuffer`/the topic tree before it reaches any
  user-visible store) and its own exclusion from subscription-liveness
  tracking, so it can never be mistaken for a stale user subscription in
  feature 2.
- Off the hot path: a slow ticker (every 60s while connected and otherwise
  idle from real user publishes), one small QoS 1 message. Lives beside
  `PingerV5` as a similarly-shaped `backend/mqtt/canary.go` component with
  its own goroutine, gated by the same connection context cancellation.
- A failed canary contributes to `degraded` with its own distinct reason
  text ("loopback probe failed — publish/subscribe path may be blocked"),
  so it never gets conflated with a rejection on a topic the user actually
  cares about.

### Failure modes

- Canary topic itself ACL-blocked while real topics are fine: false
  negative on the canary, true positive on nothing — this is exactly why
  the canary's degraded reason must say "loopback probe," never "your
  publish," so the user isn't misdirected.
- v3 disconnect-on-ACL-violation: no reason code, ever. Copy must say "the
  broker closed the connection after this publish; MQTT 3.1.1 doesn't say
  why" rather than guessing.
- Canary running against a broker with a message-rate-limited plan
  (test.mosquitto.org, some cloud brokers): keep the interval generous
  (60s, not seconds) and make it disableable per connection.

## 2. Subscription liveness self-test

### Behaviour

Confirm each subscription is still receiving broker traffic, not just
that the socket is open — ping/pong (PR #141) proves the connection is
alive, not that any given subscription still is. A broker can keep
sending PINGRESP while one subscription's delivery has quietly stopped
(session state bug, ACL revoked mid-session, broker-side routing fault).

The stated risk is false positives on genuinely idle topics — a sensor
that reports every 10 minutes is not broken at minute 9. Two levers,
reasoned through:

- **Learned cadence.** Track a rolling expected inter-arrival time per
  subscription from its own observed history. Only flag staleness once a
  baseline exists (minimum sample count, e.g. 5 messages) and the gap
  since the last message clearly exceeds it (a wide multiplier — e.g. 5x
  the learned interval, floored at some minimum like 30s — not a tight
  one, since device jitter and bursty topics are the norm, not the
  exception). No baseline, no claim: a topic with too few or too
  irregular samples to trust simply isn't tracked for liveness and falls
  back to feature 3's neutral silence state instead.
- **User-set expected cadence**, as an escape hatch for the topics a
  learned baseline gets wrong (bursty devices, or a user who already
  knows "this reports every 60s" and wants a tighter bound than 5x would
  give). Optional per-subscription field, not required.

A subscription made only of retained messages (its only traffic ever
carried `retain=true`) is excluded outright — retained values are not
"live" traffic by nature and staleness has no meaning for them.

v1 scope: liveness is tracked and shown **per subscription** (the topic
filter, e.g. `zigbee2mqtt/#`), aggregated across every concrete topic that
matches it — any matching topic reporting counts as the subscription being
alive. Per-leaf-topic staleness (flagging one dead device within a live
wildcard subscription) is a natural v2 extension, not v1: it needs the
topic tree to carry the same cadence state per node, which is a bigger
surface change than this spec's budget.

### Backend design

- New `backend/mqtt/liveness.go`: a `SubscriptionLiveness` tracker keyed
  by subscription topic filter (not concrete topic), holding
  `lastSeenAt time.Time`, a learned interval (EWMA), and a sample count.
  Matching a concrete arriving topic back to its subscription filter
  reuses `backend/topic-matching`'s existing `SubscriptionMatcher`
  (already built for exactly this: `GetMatchingSubscriptionForTopic` in
  `backend/app/mqtt.go:190`).
- **Off the hot path, deliberately.** `receiveMessage`
  (`backend/mqtt/receive.go`) forks history/buffer writes into a
  goroutine per message already; do not add a third per-message write
  there. Fold the liveness update into the existing 300ms batched drain
  instead — `MQTT_BUFFER_EMIT_INTERVAL` in `backend/app/mqtt.go`, the same
  callback that already iterates the batch once to emit the frontend event
  and persist to disk. One extra map update per message inside a pass
  that already happens, not a new pass.
- A slow ticker (5-10s) separately compares `now - lastSeenAt` against
  each subscription's threshold and fires transitions. Subscription counts
  are small (tens, not thousands) so this is cheap regardless of broker
  message rate — it is explicitly decoupled from the 2000 msg/s path.
- Model: `models.Subscription` (`backend/models/models.go:162`) gains an
  optional `ExpectedIntervalSeconds *uint` column for the user-set
  override — register in `loader/main.go`, `just new-migration
  add-subscription-expected-interval`.
- New per-connection event (`events/connections.go`, same
  `base+":"+connId` pattern as the existing set) for a liveness
  transition, carrying the subscription's topic filter, state
  (stale/recovered), last-seen time, and expected interval.

### UI surface

A subtle indicator on the subscription's row wherever subscriptions are
listed in the sidebar/tree — not the loud retained-badge treatment, a
faded/hollow dot distinct from "has data," with a tooltip: `"No messages
since 14:02 — usually arrives every ~45s."` Feeds `ConnectionHealth` as
`degraded` with that same sentence as the reason, surfaced in the latency
chip tooltip and logged via `LogStore`.

### Failure modes

- Cold-start / freshly added subscription: no baseline, silent, correctly
  so — this is `unknown`, not `degraded`.
- Bursty topics blow up EWMA variance; a fixed wide multiplier tolerates
  this at the cost of slower detection, which is the right trade-off for
  a feature whose entire premise is "don't cry wolf."
- Broker resends retained values on reconnect: exclude retained-flagged
  arrivals from the liveness update entirely (they're not evidence of
  live delivery, they're session replay), or a reconnect would look like
  instant recovery regardless of whether fresh traffic actually resumed.
- Canary traffic (feature 1) must never be attributed to a real
  subscription's liveness — it lives on its own excluded topic.

## 3. Non-retained silence disambiguation

### Behaviour

An explicit state meaning "nothing has published here since you started
watching," distinct from "no data" (ambiguous with "the tool missed it")
and distinct from "never subscribed." Cheap, because the anchor already
exists: `Connection.firstConnectedThisSessionAtMs`
(`frontend/src/stores/connections.ts:36`) is already threaded into
`SelectedTopicPanel` as `firstConnectedAtMs`
(`SelectedTopicPanel.svelte:25`, wired from `DataView.svelte:193`). No new
backend plumbing needed for the connection-level anchor — it is already
there and unused for this purpose.

The bigger real gap is upstream of the panel: `mqtt-data.ts`
(`frontend/src/views/Connection/DataView/components/MqttDataPanel/stores/mqtt-data.ts`)
only creates a tree node when a message actually arrives (node creation
happens inside the message-handling path, `messageCount`/
`latestMessageTime` set on first arrival). A subscription that has
received literally nothing has **no node at all** — there is nothing to
click, nothing to disambiguate. That is the sharper version of "cannot
tell no-data-yet from tool-missed-it": right now there isn't even a
place in the UI that admits the subscription exists and is listening.

### UI surface

- Topic tree: synthesize one placeholder row per active subscription with
  zero matched topics so far, sourced from the subscriptions store rather
  than from received messages. Selecting it shows the same silence state
  as below rather than nothing.
- `SelectedTopicPanel` empty state (currently: no dedicated copy exists
  for this case — confirmed nothing in the current tree matches "no
  messages yet" style text): `"No messages since you started watching
  (14:02)."` Neutral tone, no icon suggesting error. If a subscription-
  level "watching since" is available (subscription added mid-session,
  after `firstConnectedThisSessionAtMs`), prefer that over the
  connection-wide anchor — it's the more honest timestamp.
- Never claim more than the anchor proves: a reconnect updates
  `lastConnectedAt` (`backend/app/startup.go`'s `OnConnectionUp`, runs on
  every reconnect, not just the first connect) and could in principle have
  missed a message during the outage window. Acceptable simplification
  for v1 — call it out in open questions rather than silently asserting
  completeness the app can't actually back up.

### Backend design

None required for the connection-level anchor (already shipped). The tree
placeholder-row change is frontend-only, reading the existing
subscriptions store against the existing mqtt-data topic map.

### Failure modes

- A subscription that later gets messages must have its placeholder row
  replaced by the real node seamlessly — no flicker, no duplicate entry.
- Must not fire for retained topics that simply haven't been retained
  (that's just "nothing published here ever," same copy, still correct)
  — no special-casing needed, the copy already covers both.

## 4. Reject wildcard characters in publish topics

### Behaviour

Publishing to a topic string containing `+` or `#` is syntactically
valid-looking and semantically wrong — a broker either rejects it
outright or, per the real Node-RED incident this spec is grounded in,
disconnects the client, which then replays its entire retained store to
every client on resubscribe, with nothing naming the cause. Cheap to
prevent entirely; do so both at the point of entry and defensively in the
backend.

This applies only to the **publish** topic field. Subscription topic
filters legitimately use `+`/`#` and must not be touched by this
validation — don't let the two paths share a validator by accident.

### UI surface and copy

`PublishView.svelte` (`frontend/src/views/Connection/DataView/components/Sidebar/components/PublishView.svelte`)
already has exactly this pattern for an empty topic — a reactive block at
L46-58 that sets `publishStore.topicError` and blocks send (checked again
at L199-201 before the actual publish call). Extend the same check:

> **Topic can't contain + or #. Wildcards are for subscribing, not publishing.**

Blocking, not a warning — mirrors how the existing "Topic is required"
already blocks, and the failure mode (broker disconnect + retained flood
across every connected client) is worse than a rejected publish, so
"warn and let them send anyway" is the wrong call here. Wire it into
`PublishDetailsStore`'s `publish()` (`publish-details.ts:160-172`) next to
the existing empty-topic check, same `topicError` field, same UI
treatment — no new component.

### Backend design

Defence in depth: the frontend check can be bypassed by any other path
into `Publish` (collections replay, a saved message edited outside the
form, a future scripting API). Add a `validatePublishTopic(topic string)
error` at the top of `MqttManager.Publish` in `backend/mqtt/publish.go`,
rejecting any topic containing `+` or `#` before anything reaches the
wire — same shape as `validateConnectionDetails`/`validateSubs` already
guarding `Connect` in `connect.go`. The returned error string should
repeat the same "wildcards are for subscribing, not publishing" language
so a toast (the existing `addToast` pattern) reads the same as the inline
field error, not a second, differently-worded message.

### Failure modes

None novel — this is a pure input guard. The one thing to get right is
making sure it does not fire for `SubscriptionsForm`'s topic field, which
shares no code path with `PublishView`/`publish-details.ts` today and
should stay that way.

## Performance

Every mechanism in this spec is explicitly off the message hot path:

- Publish canary: one publish + one subscribe every ~60s, gated by
  connection idle from real user publishes. Not per-message.
- Subscription liveness: the per-message update rides inside the existing
  300ms batched buffer drain (`MQTT_BUFFER_EMIT_INTERVAL`), not a new pass
  over the stream; the staleness check itself is a 5-10s ticker over a
  handful of subscriptions, independent of message rate entirely.
- Non-retained silence: pure frontend read of already-computed state, no
  backend cost.
- Wildcard rejection: a string scan on a user-typed topic at publish time,
  irrelevant at any message rate.

None of this touches `MessageBuffer`, `MessageHistory`, or the topic tree
render path in a way that scales with throughput. `/perf-check` should
still run before merge since liveness touches the buffer-drain callback,
but nothing here is expected to move the needle at 2000 msg/s per broker.

## Files touched (indicative, not exhaustive)

- `backend/mqtt/publish.go` — `PublishOutcome`, `validatePublishTopic`,
  capture the discarded `*paho.PublishResponse`.
- `backend/mqtt/liveness.go` (new) — `SubscriptionLiveness` tracker.
- `backend/mqtt/canary.go` (new, if the loopback probe ships) — ticker
  beside `PingerV5`.
- `backend/mqtt/log_store.go` (on `feat/client-logs`, PR #104) — three new
  always-on log line kinds.
- `backend/app/mqtt.go` — `PublishMqtt` return shape,
  `GetMatchingSubscriptionForTopic` reused as-is for liveness matching.
- `backend/models/models.go`, `loader/main.go`, a new migration —
  `Subscription.ExpectedIntervalSeconds`.
- `events/connections.go` — new liveness-transition event.
- `frontend/src/components/ConnectionStatusCircle/ConnectionStatusCircle.svelte`
  — optional `health` prop.
- `frontend/src/views/Connection/DataView/components/Sidebar/components/SidebarTopBar.svelte`
  — tooltip on the latency chip.
- `frontend/src/views/Connection/DataView/components/Sidebar/components/PublishView.svelte`,
  `frontend/src/views/Connection/DataView/components/PublishPanel/stores/publish-details.ts`
  — wildcard `topicError`.
- `frontend/src/views/Connection/DataView/components/MqttDataPanel/stores/mqtt-data.ts`,
  `frontend/src/views/Connection/DataView/components/SelectedTopicPanel/SelectedTopicPanel.svelte`
  — placeholder rows, silence copy.
- `frontend/bindings/` — regenerate after any bound-method signature
  change.

## Scope cuts (v1)

- No per-leaf-topic liveness inside a wildcard subscription — subscription-
  level aggregate only.
- No cross-connection health rollup (a summary badge across every open
  connection) — this spec is entirely per-connection.
- Loopback canary is proposed but its inclusion in v1 is an open question
  below; reason-code capture on real publishes (the non-optional half of
  feature 1) should ship regardless.
- No user-facing settings UI for the EWMA thresholds/multipliers — fixed
  constants for v1, tunable later if the false-positive rate in the wild
  says otherwise.
- No retry/remediation actions (e.g. "resubscribe" button on a stale
  subscription) — this spec is diagnostics only, not self-healing.

## Open questions

1. Ship the loopback canary in v1, or hold it back and start with passive
   PUBACK-reason-code capture only? The passive half is strictly cheaper
   and has no false-negative risk from a blocked scratch topic; the active
   half is the only thing that gives a signal on a connection where the
   user hasn't published anything yet (which is most read-only/dashboard
   use of this app).
2. Does the subscription liveness EWMA multiplier (proposed: 5x learned
   interval, floor 30s) need to be per-subscription tunable in v1, or is a
   global constant acceptable until real usage shows it's wrong in either
   direction?
3. Should a `degraded` connection change the `ConnectionStatusCircle`
   enough to be noticeable in the connection tab bar (many connections
   open at once), or only in the expanded sidebar where the tooltip lives?
   The tab bar is prime alarm-fatigue territory if this gets it wrong.
4. Minimum sample count before a subscription liveness baseline is
   trusted — proposed 5 messages, arbitrary. Worth validating against a
   real device population (e.g. a Zigbee2MQTT bridge with dozens of
   devices at wildly different report intervals) before committing to a
   number.
5. For MQTT 3.1.1's total blind spot on rejected publishes (broker
   disconnects, no reason): is it worth a one-time piece of onboarding
   copy somewhere ("switch to MQTT 5 for delivery confirmation") rather
   than repeating the limitation per-incident in the log viewer?
