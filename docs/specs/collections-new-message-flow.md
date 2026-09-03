# Collections: new message from a folder, editable names, clearer creation

Branch: `feat/collection-message-flow` into `develop`.

## Problem

Collections landed in PR #156 with the workflow the wrong way round. To file
a message you create it first (the "New message" row opens the publish view)
and only then pick a folder from "Add to collection" in the top right. Two
gaps came out of review:

1. A folder row has no way to start a message inside it.
2. The "Add to collection" dropdown looks like it only lists existing
   collections. It can create one (type a name that does not match, then
   click "Create"), but nothing tells you so.

A third gap surfaced while designing the fix: a message's name is set once
(from the topic on first save) and can only be changed from the sidebar
row's Rename. The publish view shows the name but cannot edit it.

## Decisions

- Every folder's dots menu has "New message" as its first item, always. An
  empty folder also shows a clickable "New message" row in place of "No
  messages".
- A draft carries a pending collection. The publish view shows it as a chip
  in the top right where "Add to collection" sits, tooltip "Will be saved to
  {name}". A Save button appears beside Publish while a pending collection is
  set.
- Save and Publish are separate. Only Save writes to the collection.
  Publishing a pending draft leaves it pending.
- Clicking "New message" on a folder while an unrelated draft is open keeps
  the draft and retargets it to that folder.
- The dropdown's search placeholder becomes "Type to add new collection".
  The existing "Create" items keep their behaviour. No footer hint.
- Creating a collection needs a click. No Enter-to-create. Escape closes the
  menu (melt already does this).
- The backend rejects an unknown collection id on save and move with a clear
  error, with a Go test.
- No hover "+" on folder rows. The dots menu is enough.
- The message name is editable in the publish view through one clickable
  control: the name, then a pencil icon on its right that only shows on
  hover (its space is reserved so the name does not shift). One hover pill
  covers both and hugs its content rather than the header width. Clicking
  anywhere on it swaps the control for the inline name input.
- A saved message shows its collection in the same top-right chip. Picking
  another collection there moves the message (not a copy).

## Flows

### New message from a folder

1. Open the folder row's dots menu and click "New message", or click the
   "New message" row inside an empty folder.
2. The folder expands if it was collapsed.
3. The sidebar opens the publish view. If the editor holds a saved message's
   scratch copy it resets to a blank draft; an in-progress draft is kept. The
   draft's pending collection is set to this folder.
4. The header reads the draft's name (or "Untitled message" when empty). The
   top right shows a chip with a folder icon and the collection name.
   Hovering the chip shows "Will be saved to {name}". Clicking it opens the
   same "Add to collection" menu with the pending collection ticked.
5. The action row shows Save and Publish.
   - Save writes the draft into the pending collection, named after the
     draft's name, falling back to the topic, then to "Untitled message".
     The view flips to saved-message mode and the sidebar row appears in the
     folder.
   - Publish sends the message and records history. The draft stays a
     pending draft.
   - Back writes nothing. The draft and its pending collection survive, so
     the "New message" row reopens the same draft with the same chip.
6. Picking a collection from the menu saves immediately, as it does today.

Once saved, the chip shows the collection the message is in (tooltip "In
{name}"), with that collection ticked in the menu. Picking another one moves
the message there; the sidebar row leaves the old folder and both counts
update. A "Create" item creates the collection and moves the message into
it.

Global and connection collections behave the same. Only the id matters.

### Creating a collection from the dropdown

1. Open "Add to collection" (or the chip). The search field reads "Type to
   add new collection".
2. Typing filters both lists. When the typed name has no exact match in a
   scope, that scope's "Create" item appears below the lists.
3. Click "Create" to create the collection and save the message into it. The
   view flips to saved-message mode. The draft never leaves the view.

### Renaming in the publish view

1. The header title is one control: the name, then a pencil icon on the
   right, both inside one hover pill (`px-1 -mx-1`, `hover:bg-hovered`,
   `cursor-pointer`). The pencil is hidden until hover, with its space
   reserved. Long names truncate inside the pill.
2. Click anywhere on it to edit. The control swaps for the inline name input,
   prefilled with the current name (empty for an untitled draft), focused,
   text selected.
3. Enter or blur commits. Escape cancels.
4. For a draft the name is stored on the draft. Saving uses it.
5. For a saved message the rename is persisted through the existing rename
   path and the sidebar row updates.

## Copy

- Folder menu item and empty-folder row: New message
- Draft header when the name is empty: Untitled message
- Pencil control tooltip: Rename
- Chip tooltip, draft: Will be saved to {name}
- Chip tooltip, saved message: In {name}
- Save button: Save
- Search placeholder: Type to add new collection
- Create items (unchanged): Create "x", Create "x" (global)
- Toast on save (unchanged): Message saved to collection

## Edge cases

- Pending collection deleted while the draft is open: the chip is derived by
  looking the id up in the collections store. If it is gone, the pending id
  is dropped and the control falls back to "Add to collection". Save is
  hidden again.
- Draft kept across navigation: Back and reopening "New message" keep the
  draft, its name and its pending collection. Loading a different message
  into the editor drops all three: opening a saved message, opening a
  history entry, or resetting from a scratch copy.
- Empty name on save: fall back to the topic, then to "Untitled message".
  Renaming a saved message to an empty name is ignored, as the sidebar
  Rename does.
- Duplicate collection names across scopes: allowed. A global "Sensors" does
  not block a connection "Sensors". Within one scope an exact match hides
  that scope's "Create" item.
- Unknown collection id from a stale client: the backend returns
  "collection {id} not found" and the frontend shows its usual error toast.

## Implementation map

Backend (`backend/app/collections.go`, `collections_test.go`):

- `SaveCollectionMessage` checks the collection exists before saving.
  `MoveCollectionMessage` already does; make its error message match.
- Tests for both rejections.

Frontend:

- `PublishPanel/stores/publish-details.ts`: `name` and
  `pendingCollectionId` on the draft. `setSource` clears both;
  `markSaved` clears `pendingCollectionId`; a `setName` helper.
- `Sidebar/Sidebar.svelte`: `openNewMessage(collectionId?)` sets the
  pending id and expands the folder; passed down as `onNewMessage`.
- `Sidebar/components/CollectionsSection.svelte`: forwards `onNewMessage`.
- `Sidebar/components/CollectionFolder.svelte`: menu item and empty-folder
  row.
- `Sidebar/components/PublishView.svelte`: rename control, chip, Save for
  pending drafts, name used on save, rename for saved messages.
- `Sidebar/components/AddToCollectionMenu.svelte`: placeholder default.
- `Sidebar/components/InlineNameInput.svelte`: optional select-all on focus.
- Colocated `.spec.json` and stories for each changed component; story
  fixtures gain the new store fields.
- `frontend/src/changelog.ts`: unreleased entry.

No migration. The name already lives on `collection_messages`.

## Drag and drop and ordering

Filing a message was still a menu-only job: "Add to collection", or the row's
"Move to...". That is fine for one message and hopeless for arranging a
folder. Collections also had no order of their own. Everything sorted by name,
so the order you actually wanted (the message you run first at the top) was
unreachable.

### Decisions

- Order is explicit and persisted. `Position` on `Collection` (within its
  scope) and on `CollectionMessage` (within its collection). Reads order by
  position, then id. Name sorting is gone.
- Dragging a saved message between folders moves it, never copies, with no
  confirmation. A connection folder and a global one are the same kind of
  target; only the id matters.
- Messages reorder inside a folder by dragging. Folders reorder inside their
  section by dragging.
- A folder cannot be dragged between the Global and Connection sections.
  Changing a folder's scope is a different act from ordering it, the drop
  would be ambiguous next to a legitimate reorder, and every message in it
  would silently change availability. The two sections are separate lists.
- A history row can be dragged into a folder. The drop saves that entry as a
  new message named after its topic, at the drop position.
- Hovering a collapsed folder for 600 ms while dragging expands it, through
  the existing collapse store, so the expansion persists after the drop.
- The menu paths stay. The dots menu's "Move to...", the publish view's chip,
  and history's "Add to collection" are the accessible route. Keyboard
  drag and drop is out of scope.

### Interaction

- A press must move 4 px before it becomes a drag, so a click still opens the
  message. The click that follows a completed drag is swallowed.
- The dragged row dims to 40%. A clone of it follows the pointer at 70%
  opacity, `position: fixed` on `document.body`, at the row's own width.
- Between two rows the insertion point shows as a 2 px `bg-primary` line.
- Over a folder row, when the drop means "into this folder, at the end", the
  row highlights with `bg-hovered` and a `border-primary` ring.
- Within 48 px of the scroll container's top or bottom edge the sidebar
  auto-scrolls, faster the closer you are.
- Escape cancels. So does releasing outside any target. Nothing is written.
- The store applies the new order immediately, then persists. A backend
  failure reloads from the database and raises the usual error toast.

### Drop targets

| Dragging | Over | Result |
| --- | --- | --- |
| Saved message | gap in a message list | move to that collection at that index |
| Saved message | folder row | move to that collection, at the end |
| Saved message | its own position | nothing |
| History entry | gap in a message list | save as a new message at that index |
| History entry | folder row | save as a new message at the end |
| Folder | gap in the same section | reorder |
| Folder | the other section | no target, drop does nothing |

### Backend

One new mutation carries every message case:

```go
ReorderCollectionMessages(collectionID uint, orderedIDs []uint) ([]models.CollectionMessage, error)
```

It sets `collection_id` and `position` for each listed id in one transaction,
so a same-folder reorder and a cross-folder move are the same call. The
source folder is left with gaps in its positions, which is harmless because
only the relative order is read.

```go
ReorderCollections(connectionID *uint, orderedIDs []uint) error
```

rewrites positions within one scope and rejects an id whose `connection_id`
does not already match that scope, which is what keeps folders inside their
section.

The rest is bookkeeping. `SaveCollectionMessage` gives a new message
`max(position) + 1` in its collection. `MoveCollectionMessage` (the menu path)
appends at the end of the target. `DuplicateCollectionMessage` puts the copy
directly after the original and shifts the rest down.

A history drop is two calls: save (which appends), then reorder with the new
id at the drop index. The store applies both optimistically, so there is no
flash.

`just new-migration collection-ordering` adds both columns. The migration
backfills with a correlated count so existing rows keep their current id
order within each group.

### Frontend

No dependency. The maintained Svelte drag libraries either assume runes, or
own the list rendering, or use HTML5 drag events, which behave badly inside
the Wails webviews. The pieces needed here are small enough to write and
test directly.

`Sidebar/dnd/`:

- `drag-store.ts`: the one active drag. The payload (message, history entry
  or collection), the pointer position and the resolved drop target.
- `drop-index.ts`: the pure parts, unit tested. Insertion index from a
  pointer y against a list of rects, and the new ordered id list for a
  same-list reorder and a cross-list insert.
- `draggable.ts`: a `use:draggable` action. Threshold, pointer capture, the
  ghost clone, Escape, the swallowed click.
- `drop-resolve.ts`: hit testing. `document.elementFromPoint` walked up to
  the nearest `data-dnd-*` element, then the index from the sibling rects.
- `auto-scroll.ts`: the edge scroll on `[data-dnd-scroll]`.

Targets are declared with data attributes rather than a registry, so a row
only has to say what it is:
`data-dnd-list="<collectionId>"`, `data-dnd-folder="<collectionId>"`,
`data-dnd-section="<scope>"`.

Components: `CollectionsSection` (folder list, its own drop zone),
`CollectionFolder` (folder row as a handle and an into-folder target, message
list as a drop zone), `SavedMessageRow` (a handle), `HistoryItem` (a handle),
`Sidebar` (the scroll container attribute).

`stores/collections.ts` sorts by position then id instead of by name, and
gains `reorderMessages`, `reorderCollections` and `saveMessageAt`, each
optimistic with a reload-and-toast rollback.
