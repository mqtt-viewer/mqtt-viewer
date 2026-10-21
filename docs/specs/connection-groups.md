# Connection groups and search on Home

Issue: https://github.com/mqtt-viewer/mqtt-viewer/issues/203

## Why

With around 20 saved connections the Home grid turns into one flat wall of
cards, ordered by last use, and finding the right broker means scanning all of
them. The maintainer groups connections per site or per application in their
head already; the app should let them do that on screen and jump to a broker
by typing part of its name or IP.

## Goals

- Search box on the Home screen, filtering the grid as you type on connection
  name and host (anything in the connection string: host, IP, port, user).
- User-defined groups (flat folders): create, rename, delete.
- Assign a connection to a group by dragging its card onto a group section, or
  from a group field in the connection settings form.
- Collapse and expand each group; the state survives an app restart.
- Existing setups look the same until a group is made: every connection starts
  ungrouped.

## Non-goals

- Groups on the New Tab page. Its search stays as it is today.
- Nested groups, or a connection in more than one group.
- Manual ordering of groups or of cards inside a group.
- Groups in the tab bar, sidebar or anywhere outside Home.

## Anti-goals

- Deleting a group must never delete a connection.
- Search must not lose the grouping: a match is always shown under its group.

## Decided with the maintainer

1. **Layout A, collapsible sections** (mockup `home-groups-layout.html`). The
   Home grid becomes a vertical stack:
   - an `Ungrouped` section at the top holding connections with no group,
   - one section per group below it, header showing a fold caret, the group
     name and the connection count, with the usual card grid underneath.
   Clicking a header toggles it.
2. **Order** inside every section is today's Home order: connected first, then
   most recently connected, never-connected last.
3. **Groups sort alphabetically** (case-insensitive) by name.
4. **Managing groups**: a `+ Group` button in the Home header creates a group
   (default name, inline rename straight away). Each group header has a menu
   with Rename and Delete. Deleting moves its connections to Ungrouped.
5. **Search option 1, sections stay, filtered** (mockup `search-results.html`):
   - only matching cards render,
   - sections with no matches are hidden, the Ungrouped section included,
   - a folded section that has matches shows open while the search box has
     text, and returns to its saved fold state when the box is cleared (the
     saved state is not changed by searching),
   - the header count reads `N of M` while searching,
   - the matched part of the name or connection string is highlighted.
   Matching reuses `frontend/src/views/NewTab/helpers/filter.ts`
   (`filterConnections`): case-insensitive substring on name or connection
   string.

## Data model

New model in `backend/models/models.go`, registered in `loader/main.go`,
migration via `just new-migration add-connection-groups`:

```go
// ConnectionGroup is a user-made folder on the Home screen. Connections
// point at it through Connection.GroupID; nil means ungrouped.
type ConnectionGroup struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	Name      string    `json:"name" gorm:"not null"`
	Collapsed bool      `json:"collapsed" gorm:"not null;default:0"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
```

`Connection` gains `GroupID *uint` (`json:"groupId"`, indexed). The fold
state lives on the group row rather than in a separate table like
`CollectionCollapsedState`: there is exactly one Home screen, so one column is
enough. Deleting a group sets `group_id = NULL` on its connections in the same
transaction, then deletes the row.

## Backend

In a new `backend/app/connection_groups.go`, following `collections.go`:

- `GetConnectionGroups() ([]models.ConnectionGroup, error)`
- `NewConnectionGroup(name string) (models.ConnectionGroup, error)`
- `RenameConnectionGroup(id uint, name string) error`
- `SetConnectionGroupCollapsed(id uint, collapsed bool) error`
- `DeleteConnectionGroup(id uint) error` (ungroups, then deletes, one tx)
- `SetConnectionGroup(connectionID uint, groupID *uint) error` for drag and
  drop. A dedicated call because `UpdateConnection` uses GORM `Updates`, which
  skips nil fields and so cannot clear `group_id`.
- `UpdateConnection` omits `group_id` (`.Omit("group_id")`), so membership is
  only ever written by `SetConnectionGroup`. The connection form autosaves the
  whole details object on every change, and a stale `groupId` in it would
  otherwise undo a drag or resurrect a deleted group.

Names are trimmed and must be non-empty; duplicate names are allowed. Tests
use `getTestApp(t)` and cover: create, rename, collapse, delete ungroups its
connections, assigning and clearing a group, assigning to a missing group
fails.

`GetAllConnections` and `getSavedConnections` already return the whole
`Connection`, so `groupId` reaches the frontend once the field exists.
Regenerate bindings with `just bindings`.

## Frontend

- **Store**: a `connectionGroups` store (new file in `frontend/src/stores/`)
  loads groups at startup and exposes create, rename, delete, setCollapsed and
  assign. Assign updates the connection's `groupId` in the connections store
  so the grid moves the card at once. Delete also clears `groupId` on the
  affected connections in the connections store, so their cards move to
  Ungrouped without a reload.
- **Grouping logic** as a pure helper next to `filter.ts` or in
  `views/Home/helpers/`: input connections, groups, search string; output the
  ordered list of sections `{ group | null, connections, total, open }`. This
  is where order, hiding empty sections while searching, the open-while-
  searching rule and the Ungrouped-while-dragging rule live (the helper takes
  an `isDragging` flag), and it gets the vitest coverage.
- **Home.svelte**: header gets the search box (`BaseInput`, `icon="search"`,
  placeholder `Search connections`, as on New Tab) and the `+ Group` button
  next to `Add Connection`. The body renders a section component per entry.
  The `Ungrouped` section shows only when it has cards, or when it is the only
  section, so a fresh install looks like today (my call). While a card is
  being dragged, an empty `Ungrouped` section appears as a drop zone so a card
  can always leave its group (decided with the maintainer).
- **Section component** (new, under `views/Home/components/`): header with
  caret, name, count, menu (Rename, Delete); body is the existing
  `HomeConnectionList` grid. Needs its `.spec.json` and story per
  `frontend/AGENTS.md`.
- **Highlight**: card name and connection string render the matched part
  marked, through a small highlight helper; `HomeConnectionListItem` takes the
  search string as a prop.
- **Drag and drop**: HTML5 drag and drop is unreliable in the Wails webviews,
  so reuse the pointer-events approach in
  `views/Connection/DataView/components/Sidebar/dnd/`. Its payload and target
  types are collection specific; generalise only as far as a card dragged onto
  a section header or section body. Dropping on the section a card already
  belongs to does nothing. Clicking a card must still connect; a drag starts
  only after the pointer moves a few pixels.
- **Settings form**: `ConnectionForm.svelte` gets a `Group` select (`None` plus
  every group by name). Changing it calls `SetConnectionGroup` straight away,
  outside the form's autosave.

## Done when

- The checks in CLAUDE.md's pre-merge bar pass.
- Backend tests and the grouping helper tests above exist and pass.
- In server mode (`scripts/serve-browser.sh`): create two groups, drag cards
  into them, fold one, restart, fold state kept; search `192.168` shows only
  matching cards under their group headers, folded groups open, clearing
  restores; delete a group, its connections are back in Ungrouped.
- `frontend/src/changelog.ts` unreleased entry has a section for this.

## Left to the builder

- Default name of a new group, and the exact inline rename interaction (copy
  the collections folder rename).
- Visual details of the section header and the drop highlight, within the
  design tokens.
- Whether the Delete menu item confirms first. My call: no confirm, since
  nothing is lost and regrouping is quick.
