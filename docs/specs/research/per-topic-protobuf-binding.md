# Per-topic protobuf binding — build spec

Branch: `feat/per-topic-protobuf` → PR into `develop`.
Status: draft for maintainer review.

## What and why

Bind protobuf message types to topic patterns, per connection. Incoming
messages on a matching topic decode with the bound type; publishes to a
matching topic encode with it. This restores functionality removed in
Apr 2025 (commits `230c23c` backend, `f3bdb67` frontend) but with a
better binding model than either the old code or MQTTX.

MQTTX (the biggest free competitor) supports exactly one global proto
schema per connection. Its three most-repeated open feature requests
(emqx/MQTTX #1371, #1997, #1971) all ask for the same thing: different
proto message types on different topics. Nobody ships this. We had 80%
of it and deleted it.

## What the old implementation had (recoverable from git)

- `Connection.ProtoRegDir` — a directory of `.proto` files compiled at
  connect time with protocompile (`LoadProtoRegistry`, still alive in
  `backend/protobuf/registry.go`).
- `Subscription.ProtoDescriptor` — one message full-name per
  subscription (dropped by migration
  `remove-proto-descriptor-from-subscription.sql`).
- `backend/matchers/proto_matcher.go` — topic → matching subscription →
  descriptor, with topic-keyed cache.
- 208-line proto picker in `SubscriptionsForm.svelte` plus derived
  stores (`connection-protobuf-details-by-id`,
  `missing-protodescriptor-errors`). All at `f3bdb67~1`.

## Why not restore as-was: binding per subscription is too coarse

A subscription is often `#` or `factory/#`. MQTTX users explicitly ask
for topic-level granularity (one device family per message type under a
single broad subscription). Binding rules must be independent of
subscriptions.

## New design: binding rules table

Per connection, an ordered list of rules:

```
topic filter (MQTT wildcards ok)      message type
------------------------------        --------------------------
sensors/+/telemetry                   acme.Telemetry
sensors/+/config                      acme.DeviceConfig
factory/robots/#                      acme.RobotStatus
```

- Most-specific match wins; ties broken by rule order (drag to
  reorder). Standard MQTT filter matching, reuse
  `backend/topic-matching`.
- Rules apply to decode (subscribe side) and encode (publish side)
  symmetrically. Publish composer shows the resolved type when the
  topic matches a rule, with a per-publish override dropdown.
- Sparkplug stays as today: built-in implicit rules for `spBv1.0/#` and
  `spAv1.0/#` topic prefixes, overridable by an explicit user rule.
- No match → payload passes through untouched (current behaviour).
- Decode failure → raw payload + warning marker, never an error wall
  (matches current middleware behaviour, `IsDecodedProto` flag becomes
  `ProtoDecode: ok | failed | none` + descriptor name so the UI can
  show which type decoded the message).

## Data model

New table via GORM model + `just new-migration proto_binding_rules`:

```go
type ProtoBindingRule struct {
    ID           uint
    ConnectionID uint   // FK, cascade delete
    TopicFilter  string
    MessageType  string // proto full name, e.g. acme.Telemetry
    SortOrder    int
}
```

Keep `Connection.IsProtoEnabled`; re-add `ProtoRegDir` as a plain
string field (pointer, per Wails binding rules — no null types, see
memory of PR #70).

## Backend changes

1. Re-add proto dir loading at connect: `LoadProtoRegistry(dir)` per
   connection when `IsProtoEnabled` and `ProtoRegDir` set. Surface
   compile errors to the frontend as a connection-level warning (old
   `protoLoadError` flow, visible in `f3bdb67~1` stores).
2. Revive `ProtoMatcher` (from `230c23c~1`) but match against binding
   rules, not subscriptions. Keep the topic → descriptor cache;
   invalidate on rule changes.
3. `mqtt-middleware/protobuf_decode.go` / `protobuf_encode.go`: consult
   matcher first, sparkplug prefix fallback second. Fix the existing
   copy-paste bug while there: decode middleware registers itself under
   `PROTO_ENCODE_MIDDLEWARE_ID`.
4. Service layer CRUD for rules (`backend/app/`), events for rule
   changes so a live connection rebinds without reconnect.

## Frontend changes

- Connection form: proto section gains dir picker (restore from
  `f3bdb67~1`) + rules table (topic filter, type dropdown fed by
  `GetLoadedDescriptorNames`, drag reorder, delete). Validate filters
  with existing topic-filter validation.
- Message views: decoded messages show a small badge with the message
  type name (tooltip: schema file). Already have `SparkplugLogo` /
  `ProtobufLogo` components as precedent.
- Publish panel: resolved-type indicator + override dropdown.
- New components need colocated `.spec.json` + stories
  (`pnpm ds:validate` gate).

## Marketing note

This closes MQTTX's top request while their issues stay open. Changelog
entry should name the capability plainly: bind proto schemas to topic
patterns per connection.

## Website

On merge, add an entry to `docs/WEBSITE_UPDATES.md`: features list +
the protobuf/Sparkplug use-case page. Copy angle: per-topic schema
binding, which MQTTX still lacks (their #1371/#1997/#1971 remain open).

## Open questions

1. Import proto by file(s) as well as directory? Old code was dir-only.
   Suggest dir-only v1.
2. Should a rule optionally pin QoS/format defaults per topic (MQTTX
   #591 asks for per-subscription default format)? Suggest no for v1 —
   separate concern.
3. Publish-side strictness: reject publish when JSON does not match the
   bound type, or send raw with a warning? Suggest reject with inline
   error (encode already errors today).
