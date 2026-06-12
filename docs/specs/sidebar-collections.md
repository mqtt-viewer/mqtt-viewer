# Sidebar Collections — Build Spec

Branch: `feat/sidebar-collections`
Figma: [Connected view](https://www.figma.com/design/f1tvIf8T35FTls7kM6QJUs/MQTT-Viewer?node-id=3798-4438) · [Dropdown menus](https://www.figma.com/design/f1tvIf8T35FTls7kM6QJUs/MQTT-Viewer?node-id=3952-2422) · [New message](https://www.figma.com/design/f1tvIf8T35FTls7kM6QJUs/MQTT-Viewer?node-id=3901-3208) · [Collapse sidebar](https://www.figma.com/design/f1tvIf8T35FTls7kM6QJUs/MQTT-Viewer?node-id=3896-1327) · Approved mocks: [Global+Connection collections](https://www.figma.com/design/f1tvIf8T35FTls7kM6QJUs/MQTT-Viewer?node-id=6428-50), [Save + Modified tag](https://www.figma.com/design/f1tvIf8T35FTls7kM6QJUs/MQTT-Viewer?node-id=6432-10)

## Summary

The left sidebar of the Connection view is inverted from an always-visible publish
form into a **message library**: collections of named, saved publish messages plus
time-grouped publish history. The publish form becomes a second *page* of the
sidebar, reached via "New message", a saved message, or a history item, with a
back arrow to return. The old publish-history modal is retired; the search modal
absorbs saved messages and history.

## Locked product decisions

1. Two collection scopes, two sidebar sections: **Global Collections**
   (visible on every connection) and **Connection Collections** (scoped to the
   current connection).
2. **Folder model**: a saved message belongs to exactly one collection.
   "Add message to..." on an already-saved message = move.
3. No orphan messages — every saved message lives in a collection. Deleting a
   collection warns that its N messages are deleted too.
4. Editing a saved message edits a **scratch copy**. First change shows an amber
   `Modified (unsaved)` tag in the footer; explicit **Save** (secondary button
   beside Publish) commits to the collection item. Publish never implicitly saves.
5. Saving a new/unnamed message into a collection: default name = topic, inline
   rename immediately after.
6. Unpublished drafts survive back-navigation (existing in-memory
   publish-details store; no new UI).
7. History grouping: Today / Yesterday / weekday names back through this week /
   Last week / Older. Existing 500-row cap.
8. Publishing a saved message also appends to history (history = log,
   collections = curated).
9. Collection folder context menu: Rename / Delete (right-click + hover DotsThree).
10. Collapsed-rail `+` expands the sidebar straight into the publish view.
11. The current rotated-"Publish"-label collapse is fully replaced by the icon rail.
12. Connection row click → menu: **Connection details / Rename / Delete**
    (Figma "Account settings" menu; whole row is the click target).
13. Logo caret: **dropped for v1** — logo renders plain, no menu. Flagged as a
    design gap to revisit.

## Out of scope (do not touch)

- Middle topic tree, right detail panel, window chrome/tabs, status bar.
- Light mode, other in-flight branches.
- Publish wire protocol, backend MQTT logic (except new collection CRUD).
- The plug / latency indicators: render per design, behavior stays whatever the
  current app does (no new connect-toggle behavior this pass).

## Data model (SQLite via GORM)

New migration `backend/db/migrations/<timestamp>_add-collections.sql`:

```sql
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NULL,           -- NULL = global collection
  name TEXT NOT NULL,
  created_at DATETIME, updated_at DATETIME
);
CREATE INDEX collections_connid ON collections(connection_id);

CREATE TABLE collection_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- mirror of publish_histories payload columns:
  topic TEXT, qos INTEGER, retain BOOLEAN, payload TEXT,
  encoding TEXT, format TEXT, user_properties TEXT,
  header_content_type TEXT, header_response_topic TEXT,
  header_correlation_data TEXT, header_payload_format_indicator BOOLEAN,
  header_message_expiry_interval INTEGER, header_topic_alias INTEGER,
  header_subscription_identifier INTEGER,
  created_at DATETIME, updated_at DATETIME
);
CREATE INDEX collection_messages_collid ON collection_messages(collection_id);
```

Models in `backend/models/models.go`: `Collection` (with
`Messages []CollectionMessage`) and `CollectionMessage`, JSON tags camelCase,
matching `PublishHistory` field shapes for the publish columns.

## Backend app methods (`backend/app/collections.go`, pattern: `filter_history.go`)

- `GetCollectionsForConnection(connectionID uint)` → global (`connection_id IS NULL`)
  + connection-scoped, messages preloaded, ordered by name.
- `CreateCollection(name string, connectionID *uint)` → returns record.
- `RenameCollection(id uint, name string)`
- `DeleteCollection(id uint)` → cascades messages.
- `SaveCollectionMessage(params)` → create or update (id present = update = "Save").
- `MoveCollectionMessage(id, targetCollectionID uint)`
- `DuplicateCollectionMessage(id uint)` → returns copy named "<name> copy".
- `DeleteCollectionMessage(id uint)`

Regenerate Wails bindings after adding methods.

## Frontend architecture

### Component tree (new/changed under `frontend/src/views/Connection/DataView/`)

```
DataView.svelte                      (swap PublishPanel slot → Sidebar)
└─ Sidebar/ (new)
   ├─ Sidebar.svelte                 page state: 'library' | 'publish'; expanded/collapsed
   ├─ SidebarTopBar.svelte           logo (plain), latency + dot, plug icon, search, collapse
   ├─ SidebarCollapsedRail.svelte    icon rail: expand, latency mini, + (→ publish view), search
   ├─ ConnectionRow.svelte           swatch + name + caret; click → DropdownMenu
   │                                  (Connection details / Rename / Delete)
   ├─ NewMessageRow.svelte           PlusCircle + "New message" → publish view (blank draft)
   ├─ CollectionsSection.svelte      header + right-aligned "+" (inline-create combobox);
   │                                  rendered twice: scope='global' | 'connection'
   │  ├─ CollectionFolder.svelte     folder icon (open/closed), name, count; expand/collapse;
   │  │                               menu: Rename / Delete (confirm w/ message count)
   │  └─ SavedMessageRow.svelte      envelope + name; click → publish view (scratch copy);
   │                                  menu: Duplicate / Rename / Move to... / Delete
   ├─ HistorySection.svelte          grouped headers; HistoryItem rows
   │  └─ HistoryItem.svelte          chips (encoding, Retain) + topic + payload preview;
   │                                  hover DotsThree → Add message to... / Delete;
   │                                  click → publish view prefilled
   ├─ PublishView.svelte             back arrow, message name (when saved), Add to collection,
   │                                  topic input, Payload/Headers/Properties tabs, editor,
   │                                  QoS / Retain flyouts, footer:
   │                                  [Modified (unsaved)] [Save] [Publish]
   └─ AddToCollectionMenu.svelte     searchable list, checkmark on current, "+ Create <q>",
                                      "Collection not found" empty state
```

`PublishView` is a re-chrome of existing `PublishPanel` internals (topic input,
CodeEditor, QoS/retain logic, publish + history-save flow) — reuse the
`publish-details` and `publish-history` stores; do not rewrite publish logic.

### Stores

- New `collections.ts` store (per connection id, pattern of `publish-history.ts`):
  `{ globalCollections, connectionCollections }` + CRUD methods syncing backend.
- `publish-details.ts` gains: `sourceCollectionMessageId: number | null` and
  `baselineSnapshot` for dirty detection (`Modified (unsaved)` = current fields
  differ from baseline). Save → `SaveCollectionMessage`, resets baseline.
- Sidebar collapse: persist via existing `panelSizes` store / `PanelSize` table,
  panel id `"publish-panel"` `isOpen` flag (rail ≈ 48px when collapsed).

### Search modal

Extend `SearchAndHistory` results: section **Collections** (saved messages
matching name/topic/payload, right-aligned folder badge w/ collection name) above
**Previously published** (existing publish history w/ relative time + delete X).
Selecting either opens it in the publish view. The PublishHistory dialog and its
trigger are removed.

### History grouping util

`groupByRecency(items)` → ordered buckets: Today, Yesterday, weekday names for
current week, "Last week", "Older". Unit-tested.

### Icons (`components/Icon/icons.ts`)

Have: `folder`, `folderOpen`, `plus`, `check`, `close`, `menu`, `history`.
Add Phosphor re-exports: `EnvelopeSimple`, `SidebarSimple`, `DotsThree`
(horizontal), `ArrowLeft`, `PlusCircle`, `Plugs`, `PlugsConnected`, `CaretDown`.

### Empty states (designer gap — proposed copy)

- No collections in a section: muted row "No collections yet — click + to create one".
- Empty folder: muted indented row "No messages".
- No history: muted "Messages you publish will appear here".

### Visual notes

- Use design tokens; Publish button uses `--primary` (design's `#483fac` is
  off-token, intentionally corrected).
- `Modified (unsaved)`: 11px, amber `#ff8a00` (matches Retained badge family).
- Section header `+` right-aligned to sidebar edge (fixes design bug, per
  approved mock).
- Hover row highlight: full-width minus 12px margins, 4px radius (design's
  hover rect).
- DotsThree overflow appears on hover for every history/saved row, not just the
  first (design showed only one — prototype artifact).
- Fonts: design uses Mona Sans; implementation uses the app's existing font
  stack/tokens — no new font is introduced this pass.

## Design defects flagged back to design (not blocking)

- Logo caret affordance with no menu (dropped v1).
- No naming flow at save time (we use default-name + inline rename).
- No folder context menu in file (we add Rename/Delete).
- "Account settings" menu mislabeled — it's connection-level.
- Copy typos in dummy data ("temperture", "Substopic", drunk-payload strings).
- No empty states, no long-list scroll spec (we use one scroll region, sticky
  section headers).

## Build phases

1. **Backend**: migration, models, `collections.go` CRUD, bindings. Go tests for
   CRUD incl. cascade delete + global-vs-connection scoping.
2. **Sidebar shell**: Sidebar page-state container, top bar, connection row +
   menu, new-message row; swap into DataView behind existing ResizableContainer.
3. **Collections UI**: sections ×2, folders, saved rows, inline create, menus,
   move flow, empty states.
4. **PublishView**: re-chrome PublishPanel internals; scratch-copy + Save +
   Modified tag; Add to collection flow.
5. **History in sidebar**: grouping util + sections + item menus; retire
   PublishHistory modal.
6. **Search modal**: collections + previously-published sections.
7. **Collapse rail**: icon rail, persistence, `+` → publish view.
8. **Design system**: `.spec.json` + Storybook story per new component;
   `pnpm ds:validate` green; frontend unit tests (grouping, dirty detection).

Each phase ends with the app building and running; phases 1–2 land before any
visual swap is user-visible.
