# Namespace snapshot and diff — build spec

Branch: `feat/namespace-snapshot` → PR into `develop`.
Depends on: the retained-tracking index described in
`retained-message-manager.md` (`MessageHistory.RetainedUnderPrefix`,
`ResetRetainedIndex`). That index is not on `develop` yet: it lives on
the unmerged `feat/topic-tree-context-menu` branch. Land it first, or
build this on top of that branch and rebase.
Status: draft for maintainer review. Two layers: layer 1 is a normal
feature, layer 2 is the strongest paid-tier candidate this research has
found.

## What and why

Layer 1 captures a point-in-time picture of a connection's topic
namespace (every topic seen, its latest payload, retained status,
inferred type) and diffs two of these captures. Layer 2 wraps that
capture in the metadata and integrity guarantees a regulated
manufacturing site needs to keep as evidence for a change.

Uses driving layer 1:

- **Staging versus production parity.** Snapshot both connections,
  diff them, see exactly which topics or payloads drifted before they
  cause a support call.
- **Device inventory drift during commissioning.** Snapshot before and
  after wiring up a new panel or gateway; the added/removed lists are
  the punch list.
- **Home Assistant migration verification.** Snapshot the old broker's
  `homeassistant/#` tree and the new one, confirm every entity
  migrated with the same retained config, catch the ones that didn't.
- **Firmware rollout verification.** Snapshot before flashing a fleet,
  snapshot after, confirm payload shapes and retained state came back
  the same (or changed in the way the rollout intended).

None of this exists in the tools I've looked at. MQTT Explorer and
MQTTX let you look at one broker at one time; nothing in this space
does point-in-time comparison.

Layer 2 exists because regulated manufacturing running a unified
namespace (ISA-95 style, one MQTT backbone across a plant) has to
produce change-control evidence today, and the tooling for that is
manual. EMQX's biotech case study (already in hand, not re-researched
here) puts a single change at 12 to 16 weeks of change-control cycle
time, 2 to 3 days of manual compliance-report writing, and around 250
pages of documentation, across 80-plus interfaces each needing
individual validation. A namespace-level "here is what changed and
here is proof of when and how it was captured" report attacks the
manual-documentation piece directly.

## Layer 1: namespace snapshot and diff

### Mechanics note

A snapshot is a read of what this client currently knows about the
namespace, not a broker-side export. Concretely it reads
`MessageHistory`'s per-topic `latest` map (`backend/mqtt/history.go`),
which already holds one message per topic and survives eviction from
the budgeted `recent` ring buffer. That means:

- Coverage is bounded by what has actually arrived at this client
  during the current session, either through live subscriptions or a
  deep scan (see below). A topic nobody has subscribed to since
  connecting is invisible to a snapshot, exactly as it's invisible to
  the retained manager for the same reason: MQTT has no "list topics"
  operation.
- A deep scan (temporary `#` subscribe, same mechanism as the retained
  manager's) widens coverage to the whole namespace for the duration
  of the scan. Recommend it before any snapshot meant to be diffed
  later, especially the "removed" category, which is only meaningful
  if both snapshots had equivalent coverage. See "coverage mismatch"
  below.

### Wireframes

#### A. Capture dialog (action bar button in the data panel, same slot as the retained manager)

```
┌─ Take namespace snapshot — plant-broker ─────────────────────────┐
│ Name        [plant-broker · 2026-07-30 14:02_____________]       │
│ Scope       (•) whole namespace   ( ) subtree: [___________]     │
│ Coverage    [x] Deep scan first (recommended for diffing)         │
│             until quiet for 1s, up to 30s                        │
│                                                                    │
│                                    [Cancel]      [Take snapshot]  │
└────────────────────────────────────────────────────────────────────┘
```

#### B. Snapshot library (new "Namespace snapshots" window, spans connections since a diff can cross them)

```
┌─ Namespace snapshots ─────────────────────────────────────────────┐
│ plant-broker                                                       │
│   ☐ plant-broker · 2026-07-30 14:02   4,812 topics   deep scan     │
│   ☐ plant-broker · 2026-07-23 09:15   4,790 topics   deep scan     │
│ staging-broker                                                     │
│   ☐ staging-broker · 2026-07-29 11:40  312 topics   no scan        │
│                                                                    │
│                          [Delete]         [Compare selected (2)]  │
└──────────────────────────────────────────────────────────────────┘
```

- Selecting exactly two (any connections, any dates) enables Compare.
- Delete on a snapshot that a validation snapshot (layer 2) was built
  from is blocked with an explanation, not silently allowed.

#### C. Diff view

```
┌─ Diff — plant-broker 07-23 → 07-30 ───────────────────────────────┐
│ ⚠ coverage differs: 07-23 was a subtree scan (factory/#), 07-30    │
│   was whole-namespace. "Removed" below may be incomplete.          │
│                                                                    │
│ Added (14)  Removed (3)  Payload changed (211)  Retained (2)       │
│ Type changed (1)  No new message since 07-23 (58)                  │
│                                                                    │
│  factory/line3/robot9/pose            payload changed              │
│  factory/line1/status                 retained: false → true       │
│  homeassistant/sensor/dead1/config    no new message since 07-23   │
│  ...                                                               │
│                                        [Export CSV] [Export JSON]  │
└──────────────────────────────────────────────────────────────────┘
```

- Category tabs, virtualised rows underneath (same requirement as the
  retained manager: tens of thousands of rows on industrial brokers).
- Row click expands a before/after payload comparison using the
  existing `DiffCodeEditor` (`frontend/src/components/CodeEditor/DiffCodeEditor.svelte`)
  with `left`/`right` set to the two captured payloads. This is
  already a readonly side-by-side merge view with JSON auto-detect; no
  new diff-rendering code needed for the payload level, only the
  category-list chrome around it.
- "Unchanged" is a count, not a list. At namespace scale, most topics
  are unchanged; enumerating them buys nothing and blows out the
  response payload.

### Data model

New GORM models in `backend/models/models.go`, registered in
`loader/main.go`, migration via `just new-migration add-namespace-snapshots`.

```go
type NamespaceSnapshot struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	ConnectionID    uint      `json:"connectionId" gorm:"index:namespace_snapshots_connid"`
	Name            string    `json:"name"`
	TopicPrefix     string    `json:"topicPrefix"` // "" = whole namespace
	DeepScanUsed    bool      `json:"deepScanUsed"`
	DeepScanSeconds *int      `json:"deepScanSeconds"`
	TopicCount      int       `json:"topicCount"`
	BrokerHost      string    `json:"brokerHost"` // denormalised: survives the connection being edited or deleted later
	BrokerPort      int       `json:"brokerPort"`
	CapturedAt      time.Time `json:"capturedAt"`
	CreatedAt       time.Time `json:"createdAt"`
	Topics          []NamespaceSnapshotTopic `json:"-" gorm:"constraint:OnDelete:CASCADE"`
}

type NamespaceSnapshotTopic struct {
	ID               uint      `json:"id" gorm:"primaryKey;index:namespace_snapshot_topics_snap_topic,priority:2"`
	SnapshotID       uint      `json:"snapshotId" gorm:"index:namespace_snapshot_topics_snap_topic,priority:1"`
	Topic            string    `json:"topic" gorm:"index:namespace_snapshot_topics_topic"`
	Retained         bool      `json:"retained"`
	QoS              uint      `json:"qos"`
	PayloadHash      string    `json:"payloadHash"` // sha256 hex, always set
	PayloadPreview   string    `json:"payloadPreview"` // first ~200 bytes, for the row list
	PayloadStored    *[]byte   `json:"-"` // full payload, only if under MaxStoredPayloadBytes
	PayloadSize      int       `json:"payloadSize"`
	PayloadType      string    `json:"payloadType"` // json | text | protobuf | binary | empty
	LastSeenAt       time.Time `json:"lastSeenAt"` // arrival time of the captured message
}
```

`MaxStoredPayloadBytes` (propose 4096, matching the order of magnitude
of `DefaultMemoryBudgetBytes`'s per-message overhead constant in
`history.go`): above this, only the hash and preview are kept. Diffing
still works via hash comparison; the expanded payload view falls back
to "payload too large to store, showing preview only" for the rare
oversized topic. Most industrial telemetry is well under this.

At 50,000 topics with hash + preview only, a snapshot is roughly
50,000 × 350 bytes ≈ 17 MB in SQLite. That's fine for a manual,
occasional action; it is not fine to auto-capture on a timer without a
retention policy (see scope cuts).

### Diff semantics

Diff is computed backend-side (`DiffNamespaceSnapshots`), not
frontend-side: at namespace scale, shipping both full topic sets to
the frontend and diffing in Svelte is wasted bandwidth. Two
`map[string]NamespaceSnapshotTopic` built from the two snapshots'
rows, one pass, six buckets:

| Category | Rule |
| --- | --- |
| Added | topic in B, absent from A |
| Removed | topic in A, absent from B |
| Payload changed | topic in both, `PayloadHash` differs |
| Retained status changed | topic in both, `Retained` differs |
| Payload type changed | topic in both, `PayloadType` differs |
| No new message since A | topic in both, `LastSeenAt` identical in A and B |

Two honest limitations, stated in the spec rather than hidden behind a
heuristic:

- **Removed is only as good as coverage.** If A scanned
  `factory/#` and B scanned the whole namespace, or one used a deep
  scan and the other didn't, a topic can show as "removed" purely
  because A never saw it in the first place, and equally an
  actually-removed topic can hide if B's scan was narrower than A's.
  The diff view surfaces a coverage-mismatch warning whenever
  `TopicPrefix` or `DeepScanUsed` differ between the two snapshots
  (wireframe C). It does not try to guess correctness beyond that.
- **"No new message since A" will include topics that are static by
  design** (a firmware version string, a config value nobody expects
  to change), not only genuinely silent devices. Distinguishing "this
  hasn't changed because nothing's wrong" from "this hasn't changed
  because the device died" needs a message-rate history per topic,
  which doesn't exist yet (`topic-rate-ranking.md` is the spec for
  that, not built). Rather than build a guess now, ship the honest
  signal and let the reviewer's eye do the filtering; revisit once
  per-topic rate counters land.

Cross-connection diffs (the staging-vs-production case) support one
optional prefix rewrite per side, e.g. strip `staging/` from A and
`prod/` from B before matching, so equivalent subtrees under different
roots line up.

### Implementation sketch

- **Capture concurrency.** The hot path (`receiveMessage` in
  `backend/mqtt/receive.go`) already decouples storage from delivery
  via a goroutine and only ever touches `MessageHistory` and
  `MessageBuffer` under their own short-held mutexes. Capture must not
  add a new lock in that path. It reads existing state instead:
  snapshot the `latest` map's keys/values under `MessageHistory`'s
  existing mutex (same operation class as `GetAllHistory`, already
  used by `ExportAllMessages` without a dedicated fast path), release
  the lock immediately, then do hashing, type classification, and
  batched DB inserts (`CreateInBatches`, batch size ~500) outside the
  lock in a background goroutine. This mirrors the buffer's own
  snapshot-and-release drain pattern in `buffer.go`.
- **Deep scan** reuses the retained manager's mechanism exactly:
  ephemeral `#` subscription on the existing connection (inherits
  auth/TLS, no second client), suppressed from the main history/tree
  stores behind a flag, quiet-period detection (propose the same "quiet
  for 1s, capped at 30s" as the retained manager's open question,
  scaled up slightly since a full namespace sweep is heavier than a
  retained-only sweep). Scan output feeds the snapshot capture
  directly rather than the live tree.
- **Payload type classification** is new: nothing in the codebase
  currently sniffs payload content (the existing `IsDecodedProto` flag
  and `Format`/`Encoding` fields are either middleware- or
  user-declared, not content-inferred). Add a small pure function,
  something like:
  ```go
  func ClassifyPayload(payload []byte, isDecodedProto bool) string {
  	switch {
  	case isDecodedProto:
  		return "protobuf"
  	case len(payload) == 0:
  		return "empty"
  	case json.Valid(payload):
  		return "json"
  	case utf8.Valid(payload):
  		return "text"
  	default:
  		return "binary"
  	}
  }
  ```
  Good candidate for a unit test file on its own; keep it a pure
  function with no dependency on `MqttManager` so it's reusable if a
  future feature wants payload-type breakdowns elsewhere.
- **Events**: follow the `server:<kebab-name>` + `:<connId>` pattern
  from `events/connections.go`. Propose
  `MQTT_NAMESPACE_SNAPSHOT_PROGRESS` and `MQTT_NAMESPACE_SNAPSHOT_COMPLETE`,
  added to `ConnectionEventsSet`/`GetConnectionEventsSet`, emitted
  during the deep scan and the batched DB insert so the capture dialog
  can show a progress bar rather than freezing on large namespaces.
- **Service layer** (`backend/app/namespace_snapshot.go`, following
  the pattern in `export.go` and `subscriptions.go`):
  `CaptureNamespaceSnapshot`, `ListNamespaceSnapshots`,
  `DeleteNamespaceSnapshot`, `DiffNamespaceSnapshots`. `DiffNamespaceSnapshots`
  returns a result struct with the six buckets above plus an
  unchanged count; it is a synchronous call (diffing 50k rows in Go
  maps is milliseconds, this is not the part that needs a progress
  bar).
- **Frontend**: `NamespaceSnapshotDialog.svelte` (capture, wireframe
  A), a `NamespaceSnapshotLibrary` view (wireframe B), a
  `NamespaceDiffView` component (wireframe C) that reuses
  `DiffCodeEditor` per-row. New `namespace-snapshot-store.ts`. All new
  components need colocated `.spec.json` + Storybook story per
  `frontend/AGENTS.md`; `pnpm ds:validate` gates this like everything
  else in the library.

### Scale and performance

- Capture: bounded, manual, background. Progress-reported rather than
  blocking. `/perf-check` still required since the read touches
  `MessageHistory` while the hot path is live, even though it's a
  short lock hold, not a new steady-state cost.
- Diff: O(topics) in Go, not SQL joins across two tables with no
  shared key space; trivial even at six-figure topic counts.
- Storage: no auto-capture, no scheduled snapshots in v1 (see scope
  cuts), so growth is bounded by how often a user manually takes one.

### Scope cuts (v1)

- No scheduled or automatic snapshot capture; manual only.
- No live "diff as you go" mode; a diff is always between two already
  captured, static snapshots.
- No auto-pruning of old snapshots. Manual delete only, blocked when a
  layer-2 validation snapshot depends on it.
- No cross-broker-type awareness (Sparkplug topic namespace rules
  aren't specially handled; a Sparkplug topic diffs like any other
  string topic).

## Layer 2: validation evidence bundle

### What this tool can and cannot legitimately claim

Say this plainly in the product and in the report itself, not just in
this spec: **MQTT Viewer produces evidence a validated quality system
can use. It is not itself a validated Part 11 system, and capturing a
bundle does not make a change compliant.** The customer's own SOPs,
QA sign-off, and document-control process are what make something
compliant; this tool feeds an artefact into that process.

Working through ALCOA+ and 21 CFR Part 11 honestly, point by point:

| Principle | What the tool provides | Where it falls short |
| --- | --- | --- |
| Attributable | A `capturedBy` field, defaulted to the OS username, editable by the operator | No login system, no unique authenticated user identity. Anyone with desktop access can capture as anyone. This is real; the report should say so, not imply otherwise. |
| Legible | Human-readable HTML/PDF report and structured JSON | (none) |
| Contemporaneous | `CapturedAt` timestamp at the moment of capture | Relies on the desktop clock; no NTP verification, no trusted timestamp authority. Recommend the customer's own site NTP discipline; don't claim more. |
| Original | The JSON is the authoritative electronic record; the HTML/PDF is a rendered view of it | If the two ever disagree (rendering bug), JSON wins. State this in the report. |
| Accurate | Bounded by what layer 1 actually captured, coverage caveats included | Snapshot coverage limits (see layer 1) apply here too. A validation snapshot inherits every honesty caveat from the namespace snapshot it wraps. |
| Complete | Whole-namespace deep scan gets close | Not exhaustive unless deep scan was used and nothing was ACL-blocked. |
| Consistent, enduring | Hash chain (below) proves the sequence hasn't been reordered or edited after export | Chain integrity is only as strong as the local SQLite file's integrity; it proves the exported bundle wasn't altered after signing, not that the database itself is tamper-proof against a privileged local attacker. |
| Audit trail (11.10(e)) | Each validation snapshot is immutable once created and chained to the previous one | This is a snapshot history, not a full system audit trail of every user click. Don't call it that. |
| Electronic signature | Not provided | Part 11 electronic signatures need specific meaning, binding, and non-repudiation the app doesn't attempt. Out of scope; a customer wanting this signs the exported PDF with their own e-signature tooling. |

### Data model

Extends layer 1 rather than duplicating it. New migration
`add-validation-snapshots`, registered the same way.

```go
type ValidationSnapshot struct {
	ID                          uint      `json:"id" gorm:"primaryKey"`
	NamespaceSnapshotID         uint      `json:"namespaceSnapshotId" gorm:"index:validation_snapshots_nsid"`
	PreviousValidationSnapshotID *uint    `json:"previousValidationSnapshotId"` // chain link, nil for the first in a connection's chain
	CapturedBy                  string    `json:"capturedBy"` // OS username by default, operator-editable
	ToolVersion                 string    `json:"toolVersion"`
	PermissionDiffJSON          *string   `json:"permissionDiffJson"`
	SchemaTrailJSON             *string   `json:"schemaTrailJson"`
	ContentHash                 string    `json:"contentHash"`  // sha256 over the canonical serialisation of this record
	PreviousHash                *string   `json:"previousHash"` // copy of the previous record's ContentHash, nil for the first
	CreatedAt                   time.Time `json:"createdAt"`
}
```

**Permission diff, scoped honestly.** MQTT Viewer is a client; it has
no access to a broker's ACL configuration (a Mosquitto ACL file, an
EMQX authorisation rule set) unless the broker exposes an admin API
and the user has admin credentials, which most client users don't.
What this can capture is narrower and still useful: the *effective
permission outcome for the credentials this snapshot's connection
used*, meaning subscribe results per topic filter (suback reason codes on
v5, or simply whether messages arrived on v3), and, if a publish test
is explicitly opted into, publish/puback reason codes for a set of
probe topics. Call this field what it is: an observed-permission diff
for one credential, not a broker ACL export. A future broker-specific
integration (EMQX's HTTP API, for instance) could pull real ACLs
later; that's out of scope for v1 and would be broker-specific work,
not a generic MQTT feature.

**Schema version trail.** Per topic, the sequence of `PayloadType`
values across the connection's snapshot history, plus, where a
protobuf/Sparkplug binding is configured (`per-topic-protobuf-binding.md`),
the descriptor identity (hash of the compiled `.proto` bytes from
`backend/protobuf/registry.go`'s `ProtoRegistry`) that was active at
capture time. This lets a reviewer answer "which schema version was
this topic validated against on this date" without re-deriving it from
source control history.

### Report structure

Suggested section order for the human-readable report:

1. **Cover.** Report title, connection identity (name, host, not
   credentials), both capture timestamps, `capturedBy`, tool version,
   snapshot IDs, this record's hash and the previous record's hash,
   and a visible banner: *"This is evidence for your change-control
   process. It is not a certificate of compliance."*
2. **Diff summary.** The six-category counts from layer 1, as numbers
   up front.
3. **Namespace structure.** Point-in-time tree summary (top-level
   subtree counts and sizes) plus a reference to the JSON export for
   full topic-by-topic detail. A 50,000-row printed table is not
   useful evidence; the summary plus the machine-readable companion
   is.
4. **Diff detail.** One table per category (added, removed, payload
   changed, retained changed, type changed, no new message since
   previous), each row topic, before/after summary, timestamps.
5. **Observed permissions.** The credential-scoped permission diff,
   with the scoping caveat from above repeated inline, not just in an
   appendix nobody reads.
6. **Schema version trail.** Per-topic type/descriptor history across
   the connection's snapshots to date.
7. **Integrity.** This record's content hash, the previous record's
   hash, and plain-language instructions for recomputing the hash from
   the JSON companion to verify nothing changed after export.
8. **Appendix.** Capture configuration (deep scan used, duration,
   topic prefix), tool version, the ALCOA+ table above, the banner
   from the cover repeated.

### Output formats

**Human-readable: self-contained HTML, not generated PDF.** Reasons:

- Go has no first-class PDF library in this codebase already, and
  adding one (`gofpdf`, `wkhtmltopdf` as an external binary dependency,
  or similar) is a new dependency surface to maintain for a single
  feature, on a project run by one developer.
- Wails already embeds a full browser engine for the app UI. A
  self-contained HTML file (inline CSS, no external assets) opens
  correctly in that same engine or any browser, and "Print to PDF" is
  a one-click, zero-dependency operation any QA reviewer already knows
  how to do. A `@media print` stylesheet makes that PDF look
  deliberate rather than like a printed webpage.
- HTML stays diffable and greppable if a customer wants to check
  reports into their own document-control repository, which a binary
  PDF doesn't.

If a customer's document system genuinely requires a delivered PDF
rather than "export HTML, print to PDF yourself," that's a real gap
worth revisiting once it's an actual blocker, not a hypothetical one.
Flagged in open questions.

**Machine-readable: JSON.** One file, same data as the HTML report,
structured for CI or a customer's own compliance tooling to ingest.
This is the authoritative record (see "Original" in the ALCOA+ table);
the HTML is generated from it, not the other way round.

### Tamper-evident hash chain

Per connection, `ValidationSnapshot` records form a linked chain:
`ContentHash` is a SHA-256 over the canonical JSON serialisation of
the record (namespace structure reference, permission diff, schema
trail, metadata, excluding the hash fields themselves), and
`PreviousHash` copies the prior record's `ContentHash`. Any edit to a
historical record's content, or any reordering, breaks the chain from
that point forward, which recomputation against the exported JSON
detects.

Be precise about what this proves and what it doesn't: it proves the
exported bundle is internally consistent and unaltered since it left
the chain. It does not prove the local SQLite database was never
edited directly by someone with file access and enough knowledge to
recompute a consistent replacement chain, and it is not a substitute
for a trusted third-party timestamp or a cryptographic signature tied
to an identity. A signed variant (GPG or an OS keychain key, external
RFC 3161 timestamping) is a reasonable v2 if customers ask for
non-repudiation beyond internal consistency; not built for v1.

Deleting a `NamespaceSnapshot` or `ValidationSnapshot` that isn't the
tip of its chain is blocked in the UI and the service layer, with an
explanation that it would break verification for every later link.

### Implementation sketch

- New models above, registered in `loader/main.go`, own migration.
- `backend/app/validation_snapshot.go`: `CreateValidationSnapshot(namespaceSnapshotId, capturedBy, runPermissionProbe bool)`,
  `ExportValidationReport(validationSnapshotId, format)` (`format` = `html` or `json`),
  `VerifyValidationChain(connectionId)` (walks the chain, recomputes
  hashes, reports the first break if any).
- Report generation: a Go `html/template` (stdlib, no new dependency)
  producing the self-contained HTML with inline CSS; the JSON export
  is a direct struct marshal of the same data assembled for the
  template.
- Permission probe (optional, explicit opt-in per capture, since it
  publishes/subscribes as a side effect): reuses the existing publish
  path and suback/puback reason-code handling already in the MQTT v5
  client, no new wire-protocol code.

### Scope cuts (v1)

- No electronic signature workflow. Out of scope entirely, not
  deferred as "v2 signature": the app has no user-account system to
  bind a signature to, and building one just for this would be a
  different, much bigger feature.
- No broker-specific ACL API integration (EMQX HTTP API or similar).
  Permission diff stays scoped to observed-per-credential.
- No cryptographic signing of the hash chain (plain SHA-256 chain
  only). No external timestamp authority integration.
- No generated PDF. HTML with print styles only.
- No cross-connection validation bundles; a validation snapshot wraps
  one namespace snapshot from one connection, matching how a
  regulated site validates one system at a time.

## Pricing and packaging

Layer 1 (snapshot and diff) is a reasonable core-app feature: it
competes directly with a gap in MQTT Explorer and MQTTX, and broad
availability drives adoption the way the retained manager and
topic-rate-ranking specs are pitched. I wouldn't gate it.

Layer 2 (validation evidence bundle) is the strongest candidate for a
paid tier this research has turned up. The audience is narrow
(regulated manufacturing running unified-namespace MQTT), the pain is
quantified and expensive (weeks of change-control cycle time, days of
manual report writing per change), and nothing else in this space
targets it specifically. Propose a "Validation" add-on: hash-chained
validation snapshots, the exportable report, the permission and schema
trail, gated behind a licence check. This repo has no existing
feature-gating mechanism to hang that off; it would need to be built,
and the licence check itself belongs with the portal (`mqtt-viewer/cloud`),
not here.

## Open questions

1. Deep scan default duration for a whole-namespace sweep: the
   retained manager spec suggests 1s quiet / 15s cap for a
   retained-only scan. A full namespace sweep sees far more traffic;
   propose 1s quiet / 30s cap but this needs testing against a real
   large namespace, not a guess.
2. Where does the snapshot library live: a new top-level window (like
   Broker Status), or folded into an existing one? It needs to span
   connections for cross-connection diff, so it can't be locked inside
   a single connection's data-panel window the way the retained
   manager is.
3. Auto-prune policy for layer-1 snapshots. V1 ships manual delete
   only; is that acceptable, or does even the free tier need a
   default cap (e.g. keep the last 20 per connection) before someone's
   database quietly grows unbounded?
4. Licence gating mechanism for the Validation add-on: this needs
   design work in both this repo (a feature-flag check) and the portal
   (the entitlement itself). Not scoped here.
5. Is "no new message since the previous snapshot" useful enough
   without per-topic rate history, or does it need to wait for
   `topic-rate-ranking.md`'s counters to be trustworthy? I'd ship the
   honest, simpler signal now rather than block layer 1 on a feature
   that isn't built, but you might disagree given how central "stale
   device" detection is to the pitch.
6. Should the Validation report's PDF gap (HTML + browser print only)
   be resolved before launch, or is it fine to ship and revisit if a
   real customer pushes back?
7. Per-connection hash chains, or one global chain across every
   connection's validation snapshots? Per-connection matches how a
   site validates one system at a time; global would be a simpler
   single ledger to reason about but mixes unrelated brokers in one
   chain.
