# Retained message manager — build spec

Branch: `feat/retained-manager` → PR into `develop`.
Depends on: PR #121's retained tracking index in `MessageHistory`
(currently stacked on #76 — the index piece could be cherry-picked out
if #76 stays parked).

## What and why

One place to see every retained message the client knows about — with
age, size, and payload preview — and clear them singly or by subtree.

Why it matters (every researched segment hit this):

- Retained messages are invisible state: they outlive publishers and
  resurface on every new subscribe. Stale ones cause the classic
  ghost-device problems (Home Assistant discovery configs resurrecting
  deleted devices; Zigbee2MQTT availability stuck offline).
- Clearing one today means hand-publishing an empty retained payload
  to the exact topic (`mosquitto_pub -t ... -n -r`). Clearing a
  subtree means doing that once per topic. MQTT Explorer's recursive
  delete is the single feature its users cite most; mqttui ships
  `clean-retained` as a headline command; MQTTX has nothing.
- EMQX exposes retained management broker-side, but that needs
  dashboard admin access. A client-side manager works on any broker.

Mechanics note: MQTT has no "list retained" operation. A client only
learns retained messages by subscribing and receiving messages flagged
retained. So the manager works over what the current subscriptions
have delivered — plus an optional deep scan (temporary `#` subscribe)
to sweep the whole namespace.

## Wireframes

### A. Manager dialog (action bar button in the data panel)

```
┌─ Retained messages — plant-broker ───────────────────────────────┐
│ filter: [zigbee2mqtt/________]      147 retained · 210 KB total  │
│                                          [Deep scan namespace]   │
│  ☐  topic                          age      size   payload       │
│  ☐  zigbee2mqtt/bridge/state       2d 4h    22 B   online        │
│  ☐  zigbee2mqtt/0x00158d.../avail  6d 1h    7 B    offline       │
│  ☑  homeassistant/sensor/dead1/config  41d  612 B  {"name":...   │
│  ☑  homeassistant/sensor/dead2/config  41d  598 B  {"name":...   │
│  ☐  factory/line1/status           4h       89 B   {"state":...  │
│                                                                  │
│  sort: [age ▾]        [Clear selected (2)]  [Clear subtree...]   │
└──────────────────────────────────────────────────────────────────┘
```

- Row click → opens the topic in the main view (existing selection
  event). Age = now − arrival of the retained copy.
- Deep scan: temporary `#` subscription for a few seconds, collect
  retained-flagged arrivals, unsubscribe. Progress + cancel; warning
  when the broker ACLs block `#`.

### B. Clear-subtree confirmation (destructive — always confirm)

```
┌─ Clear retained subtree ─────────────────────────────────────────┐
│ This publishes an empty retained payload to 23 topics under      │
│   homeassistant/sensor/#                                         │
│ The broker forgets these values for every client, not just this  │
│ one. This cannot be undone.                                      │
│   [Cancel]                     [Clear 23 retained messages]      │
└──────────────────────────────────────────────────────────────────┘
```

### C. Tree affordance

Retained badge (already shown on messages today) gains a context-menu
entry via PR #121's menu: "Clear retained message" on a leaf, "Clear
retained in subtree..." on a folder — both route through the same
confirm dialog.

## Implementation sketch

- **Index**: PR #121 already adds retained tracking to
  `MessageHistory` (topic → latest retained message). Extend with
  arrival timestamp + payload size if not present. An empty-payload
  retained arrival removes the topic from the index (that is the
  broker's own deletion signal, so state stays honest even when
  another client clears).
- **Clear** = publish zero-byte payload, retain=true, QoS 1, via the
  existing publish path. Batch clears iterate with a small concurrency
  cap and report per-topic failures (ACL denials surface as puback
  reason codes on v5, timeouts on v3).
- **Deep scan**: implement as an ephemeral subscription on the
  existing connection (not a second client) to inherit auth/TLS;
  suppress scan traffic from the main history/tree stores behind a
  flag so a `#` sweep does not pollute the session (and does not blow
  the memory budget — scan results go only to the retained index).
- **Dialog**: new `RetainedManagerDialog` (design-system gates apply).
  Virtualised list — retained sets can be tens of thousands of topics
  on industrial brokers.
- **Perf**: index update is O(1) per retained arrival; `/perf-check`
  still required since it touches the message path.

## Scope cuts (v1)

- No cross-connection view; per connection only.
- No scheduled/automatic ghost detection (that heuristic belongs to
  the HA discovery browser feature already in flight — this manager is
  its substrate).
- No retained-message editing (publish flow already covers "replace a
  retained value": publish with retain set).

## Website

On merge, add an entry to `docs/WEBSITE_UPDATES.md`: features list +
Home Assistant use-case page (ghost devices / stale discovery configs
angle). Screenshot of the manager dialog.

## Open questions

1. Deep scan default duration: fixed 5s vs "until rate settles"?
   Suggest until retained arrivals go quiet for 1s, capped at 15s.
2. Show payloads inline (as wireframed) or only on row expand? Inline
   first 40 chars feels right; confirm against design system table
   component.
3. QoS for clears: 1 (delivery confirmation) vs 0 (fire-and-forget)?
   Suggest 1.
