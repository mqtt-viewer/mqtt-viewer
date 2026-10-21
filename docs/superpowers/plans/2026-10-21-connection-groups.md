# Connection groups and search on Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Home screen group connections into collapsible, user-made sections and filter them with a search box.

**Architecture:** A `connection_groups` table plus a nullable `connections.group_id`, served by a small Wails service file. On the frontend a pure helper turns connections, groups, search text and drag state into an ordered list of sections; Home renders one section component per entry. Drag and drop is a Home-local pointer-events action modelled on the sidebar collections one.

**Tech Stack:** Go, GORM, SQLite, Atlas migrations, Wails v3 bindings; Svelte 5 (legacy syntax), Tailwind tokens, vitest, Storybook.

**Spec:** `docs/specs/connection-groups.md`

## Global Constraints

- Svelte components use legacy syntax (`export let`, `on:click`); no runes.
- Tailwind token utilities only, never hex.
- Every new `.svelte` under `src/views/` ships `<Name>.spec.json` (`pnpm ds:make-spec <Name>`) and `<Name>.stories.svelte`; new Wails methods get a mock in `frontend/.storybook/mocks/bindings/mqtt-viewer/backend/app/app.ts`.
- Presentational components render from props only: no store reads or bindings calls in the render path.
- Never edit `frontend/bindings/`; regenerate with `just bindings`. Never run a global `wails3`.
- Backend tests use `getTestApp(t)`.
- UI copy follows `docs/WRITING_STYLE.md`: no emojis, no em dashes, British spelling, terse.
- Copy fixed by the spec: section `Ungrouped`; header button `+ Group`; search placeholder `Search connections`; header menu items `Rename`, `Delete`; form field label `Group` with option `None`; count `N` normally, `N of M` while searching.
- Commits: conventional prefix with scope `home` or `connection-groups`; no `Claude-Session:` trailer.

## Review Focus

1. Whitespace around a search (`" 192.168 "`, or only spaces) should behave as the trimmed text, and only spaces should show everything. Test in Task 2.
2. A connection created after groups exist should land in Ungrouped and make that section appear. Test in Task 2 (helper) and Task 1 (`NewConnection` leaves `GroupID` nil).
3. The connection form's autosave must not undo a drag: saving details with a stale `groupId` leaves membership alone. Test in Task 1.
4. Deleting a group that holds a connected connection leaves it connected and moves it to Ungrouped. Test in Task 1 (row stays, `group_id` NULL); manual check in Task 7.
5. A short press on a card still connects; only a move past 4px starts a drag. Manual check in Task 7, threshold constant shared with the sidebar value.

---

### Task 1: Backend groups model, service and bindings

**Files:**
- Modify: `backend/models/models.go` (new `ConnectionGroup`; `Connection.GroupID`)
- Modify: `loader/main.go` (register `&models.ConnectionGroup{}`)
- Create: `backend/db/migrations/<timestamp>_connection-groups.sql` (via `just new-migration connection-groups`)
- Create: `backend/app/connection_groups.go`
- Modify: `backend/app/connections.go` (`UpdateConnection` omits `group_id`)
- Test: `backend/app/connection_groups_test.go`
- Regenerate: `frontend/bindings/` (`just bindings`)
- Modify: `frontend/.storybook/mocks/bindings/mqtt-viewer/backend/app/app.ts`, `frontend/.storybook/mocks/bindings/mqtt-viewer/backend/models/models.ts`

**Interfaces:**
- Produces (Go, all on `*App`):
  - `GetConnectionGroups() ([]models.ConnectionGroup, error)`, ordered `name COLLATE NOCASE asc, id asc`
  - `NewConnectionGroup(name string) (models.ConnectionGroup, error)`
  - `RenameConnectionGroup(id uint, name string) (models.ConnectionGroup, error)`
  - `SetConnectionGroupCollapsed(id uint, collapsed bool) error`
  - `DeleteConnectionGroup(id uint) error`
  - `SetConnectionGroup(connectionID uint, groupID *uint) error`
- Produces (TS bindings): `models.ConnectionGroup { id: number; name: string; collapsed: boolean; createdAt; updatedAt }`, `models.Connection.groupId: number | null`.

- [ ] **Step 1: Add the model and field.** `ConnectionGroup` exactly as the spec's Data model block. On `Connection`, after `CustomIconSeed`: `GroupID *uint` with `json:"groupId" gorm:"index:connections_group_id"`. Register in `loader/main.go`.

- [ ] **Step 2: Generate the migration.** Run `just new-migration connection-groups`. Expected: a new SQL file creating `connection_groups`, adding `group_id` to `connections` and its index, and `atlas.sum` updated. Read the SQL; if Atlas rebuilds `connections` through a temp table, confirm it copies every existing column.

- [ ] **Step 3: Write the failing tests** in `backend/app/connection_groups_test.go`, reusing `getTestAppWithConnection` and `uintPtr` from `collections_test.go`:
  - `TestNewConnectionGroupTrimsName`: `NewConnectionGroup("  Site A  ")` returns `Name == "Site A"`, `Collapsed == false`, non-zero `ID`.
  - `TestNewConnectionGroupRejectsEmptyName`: `NewConnectionGroup("   ")` returns an error; `GetConnectionGroups()` is empty.
  - `TestGetConnectionGroupsSortsByNameIgnoringCase`: create `"beta"`, `"Alpha"`, `"alpha"`; names come back `["Alpha", "alpha", "beta"]` (id breaks the tie).
  - `TestRenameConnectionGroup`: rename to `" Site B "` returns and persists `"Site B"`; rename to `""` errors and leaves the old name; rename of id 999 errors.
  - `TestSetConnectionGroupCollapsedPersists`: set true, `GetConnectionGroups()[0].Collapsed == true`; set false, back to false.
  - `TestSetConnectionGroupAssignsAndClears`: assign `&group.ID`, reload the connection row, `GroupID` equals it; assign `nil`, reload, `GroupID == nil`.
  - `TestSetConnectionGroupRejectsMissingGroupOrConnection`: `SetConnectionGroup(connID, uintPtr(999))` errors and row unchanged; `SetConnectionGroup(999, &group.ID)` errors.
  - `TestDeleteConnectionGroupUngroupsConnections`: two connections in the group; delete; group gone from `GetConnectionGroups()`; both connection rows still exist with `GroupID == nil`.
  - `TestUpdateConnectionLeavesGroupAlone`: assign the connection to group A; call `UpdateConnection` with the loaded details, `Name` changed and `GroupID` set to `nil`; reload: name changed, `GroupID` still A. Repeat with `GroupID` set to another group B's id: still A.
  - `TestNewConnectionIsUngrouped`: with one group existing, `NewConnection()` returns details with `GroupID == nil`.

- [ ] **Step 4: Run them to see them fail.** Run: `rtk proxy go test ./backend/app/ -run 'ConnectionGroup|UpdateConnectionLeavesGroupAlone|NewConnectionIsUngrouped' -v`. Expected: compile failure, `undefined: (*App).NewConnectionGroup`.

- [ ] **Step 5: Implement `backend/app/connection_groups.go`.** Names go through `strings.TrimSpace`; empty returns `errors.New("group name cannot be empty")`. A missing group returns `fmt.Errorf("connection group %d not found", id)`; a missing connection returns `fmt.Errorf("connection %d not found", id)`. `SetConnectionGroup` checks both rows exist, then `Update("group_id", groupID)` on the connection. `DeleteConnectionGroup` runs in one `a.Db.Transaction`: set `group_id = NULL` where `group_id = id`, then delete the group. In `UpdateConnection`, change the write to `a.Db.Model(updated).Omit("group_id").Updates(conn)`.

- [ ] **Step 6: Run the tests to see them pass.** Same command. Expected: PASS. Then `just test`. Expected: all green.

- [ ] **Step 7: Regenerate bindings and mocks.** Run `just bindings`; expected: new functions in `frontend/bindings/mqtt-viewer/backend/app/app.ts` and `ConnectionGroup` in `.../backend/models/models.ts`. Add matching mocks to the Storybook `app.ts` mock (`GetConnectionGroups` returns `[]`, the rest resolve without effect) and, if the mock `models/models.ts` declares classes by hand, a `ConnectionGroup` class and `groupId = null` on its `Connection`. Add `groupId: null` to `mockConnectionDetails` in `frontend/src/stories/fixtures.ts`.

- [ ] **Step 8: Commit.**
```bash
git add backend loader frontend/bindings frontend/.storybook frontend/src/stories/fixtures.ts
git commit -m "feat(connection-groups): add connection groups to the backend"
```

### Task 2: Section and highlight helpers

**Files:**
- Create: `frontend/src/views/Home/helpers/sections.ts`
- Create: `frontend/src/views/Home/helpers/highlight.ts`
- Test: `frontend/src/views/Home/helpers/sections.test.ts`, `frontend/src/views/Home/helpers/highlight.test.ts`

**Interfaces:**
- Consumes: `filterConnections` from `@/views/NewTab/helpers/filter`; `Connection` from `@/stores/connections`; `ConnectionGroup` from `bindings/mqtt-viewer/backend/models/models`.
- Produces:
```ts
export interface HomeSection {
  group: ConnectionGroup | null; // null = Ungrouped
  connections: Connection[];     // matches only, in Home order
  total: number;                 // all connections in the section, ignoring search
  open: boolean;                 // render the card grid
}
export const sortForHome: (connections: Connection[]) => Connection[];
export const buildHomeSections: (args: {
  connections: Connection[];
  groups: ConnectionGroup[];     // already alphabetical from the backend
  search: string;
  isDragging: boolean;
}) => HomeSection[];
// highlight.ts
export const highlightParts: (text: string, search: string) => { text: string; match: boolean }[];
```

- [ ] **Step 1: Write the failing tests.** Build connections with a small local factory (`{ connectionDetails: { id, name, host, groupId, lastConnectedAt }, connectionString, connectionState }`). In `sections.test.ts`:
  - `sortForHome keeps today's Home order`: connected first, then `lastConnectedAt` descending, `null` last.
  - `ungrouped comes first, then groups in the given order`: section `group` ids are `[null, A, B]`.
  - `hides Ungrouped when empty unless it is the only section`: all connections in A → sections `[A]`; no groups at all → `[Ungrouped]`.
  - `shows an empty Ungrouped while dragging`: all in A, `isDragging: true` → `[Ungrouped (0 connections), A]`.
  - `shows empty groups when not searching`: group B with no connections is present, `total 0`.
  - `open follows collapsed when not searching`: A collapsed → `open false`.
  - `search filters cards and hides sections without matches`: `"192.168.10"` with matches only in A → sections `[A]`, A's `connections` are only the matches, `total` is A's full count.
  - `search opens collapsed sections with matches`: A collapsed, has a match → `open true`.
  - `search is trimmed`: `"  192.168.10 "` gives the same result as `"192.168.10"`; `"   "` gives the not-searching result.
  - `a connection whose groupId has no group is shown as Ungrouped`.
  In `highlight.test.ts`:
  - `highlightParts("mqtt://192.168.10.21:1883", "168.10")` → `[{text:"mqtt://192.",match:false},{text:"168.10",match:true},{text:".21:1883",match:false}]`.
  - Case-insensitive, keeps original casing: `("Line PLC", "plc")` → `[{"Line ",false},{"PLC",true}]`.
  - Every occurrence: `("aXaXa", "x")` gives two match parts.
  - Empty or whitespace search → `[{ text, match: false }]`.

- [ ] **Step 2: Run them to see them fail.** Run (from `frontend/`): `pnpm vitest run src/views/Home/helpers`. Expected: FAIL, cannot resolve `./sections`.

- [ ] **Step 3: Implement both helpers.** `sortForHome` lifts the comparator out of `Home.svelte` unchanged. `buildHomeSections` trims `search` once, filters each bucket with `filterConnections`, and treats "searching" as `search.trim() !== ""`. `highlightParts` matches the trimmed search case-insensitively with `indexOf` in a loop (no regex, so dots in IPs stay literal).

- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(home): add section and highlight helpers"`

### Task 3: Groups store and connections store wiring

**Files:**
- Create: `frontend/src/stores/connection-groups.ts`
- Modify: `frontend/src/stores/connections.ts` (add `setGroupLocally`)
- Modify: `frontend/src/stores/initialization.ts` (init the new store)
- Test: `frontend/src/stores/connection-groups.test.ts`

**Interfaces:**
- Consumes: Task 1 bindings.
- Produces:
```ts
// connection-groups.ts, default export
{
  subscribe, // Readable<ConnectionGroup[]>, alphabetical
  init: () => Promise<void>,
  create: (name: string) => Promise<ConnectionGroup>,
  rename: (id: number, name: string) => Promise<void>,
  remove: (id: number) => Promise<void>,
  setCollapsed: (id: number, collapsed: boolean) => Promise<void>,
  assign: (connectionId: number, groupId: number | null) => Promise<void>,
}
// connections.ts, added to the default export
setGroupLocally: (connectionIds: number[], groupId: number | null) => void
```

- [ ] **Step 1: Write the failing test** with `vi.mock("bindings/mqtt-viewer/backend/app/app", ...)` as `stores/update.test.ts` does, and mock `@/stores/connections` to spy on `setGroupLocally`:
  - `init loads groups`: `GetConnectionGroups` resolves two groups → store value equals them.
  - `create inserts alphabetically`: after `create("Beta")` with `["Alpha","Gamma"]` loaded, names are `["Alpha","Beta","Gamma"]`.
  - `rename re-sorts and keeps the backend's trimmed name`.
  - `remove clears groupId on that group's connections`: `setGroupLocally` called with the ids of connections whose `groupId` was the removed id, and `null`.
  - `assign calls SetConnectionGroup then setGroupLocally([id], groupId)`; when `SetConnectionGroup` rejects, `setGroupLocally` is not called and the error propagates.
  - `setCollapsed updates the group in place and persists`.

- [ ] **Step 2: Run it to see it fail.** Run: `pnpm vitest run src/stores/connection-groups.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** A `writable<ConnectionGroup[]>` re-sorted with `localeCompare(..., { sensitivity: "base" })` after create and rename. `remove` reads `get(connections)` to find the affected ids. `setGroupLocally` in `connections.ts` updates `connectionDetails.groupId` for each id in one `update`. Add `connectionGroups.init()` to the `Promise.all` in `initialization.ts`.

- [ ] **Step 4: Run it to see it pass.** Same command, then `pnpm test:run`. Expected: PASS; `initialization.test.ts` still green (add a mock for the new store there if it mocks each store).

- [ ] **Step 5: Commit.** `git commit -m "feat(connection-groups): add groups store"`

### Task 4: Home sections, search and group management

**Files:**
- Create: `frontend/src/views/Home/components/HomeGroupSection/HomeGroupSection.svelte` (+ `.spec.json`, `.stories.svelte`)
- Modify: `frontend/src/views/Home/components/HomeConnectionList/HomeConnectionList.svelte` (pass `search` through)
- Modify: `frontend/src/views/Home/components/HomeConnectionList/HomeConnectionListItem.svelte` (`export let search = ""`, highlighted name and connection string)
- Modify: `frontend/src/views/Home/components/HomeHeaderBar.svelte` (search box, `+ Group`)
- Modify: `frontend/src/views/Home/Home.svelte`
- Regenerate: `component-index.json`, `COMPONENT_CHECKLIST.md` (`pnpm ds:validate`)

**Interfaces:**
- Consumes: `buildHomeSections`, `sortForHome`, `highlightParts` (Task 2); `connectionGroups` store (Task 3).
- Produces: `HomeGroupSection` props:
```ts
export let section: HomeSection;
export let isSearching = false;
export let isRenaming = false;            // start in inline rename (new group)
export let isDropTarget = false;          // highlight while a card hovers it
export let onToggle: () => void = () => {};
export let onRename: (name: string) => void = () => {};
export let onDelete: () => void = () => {};
```
  The root element carries `data-group-drop={section.group?.id ?? "ungrouped"}` for Task 5. `HomeHeaderBar` gains `export let search = ""` (bound) and `export let onAddGroup = () => {}`.

- [ ] **Step 1: Scaffold specs.** Run `pnpm ds:make-spec HomeGroupSection`; write the story with three stories: a group open with three cards, a group collapsed, and Ungrouped while searching (`N of M` count, one highlighted card).

- [ ] **Step 2: Build `HomeGroupSection`.** Header: caret (`Icon` chevron, rotated when closed), name, count (`section.total`, or `${section.connections.length} of ${section.total}` when `isSearching`), and for a real group a `DropdownMenu` with `Rename` / `Delete`. Rename uses `InlineNameInput` with `selectAll` (import it from the sidebar components folder). Ungrouped has no caret, no menu, and is always open. Body is `HomeConnectionList` when `section.open`.

- [ ] **Step 3: Wire Home.** `Home.svelte` holds `search`, `renamingGroupId`, `draggingConnectionId` and `dropTarget`, and renders `buildHomeSections({ connections, groups: $connectionGroups, search, isDragging: draggingConnectionId !== null })`. `+ Group` calls `connectionGroups.create("New group")` and sets `renamingGroupId` to the result. A rename committed empty keeps the old name. Delete calls `connectionGroups.remove` with no confirmation. Toggle calls `setCollapsed`, but only when not searching. Failures show an error toast through `addToast`, titled `Failed to create group`, `Failed to rename group` and so on. The empty-state branch (no connections) stays as it is.

- [ ] **Step 4: Verify.** Run `pnpm check` (0 errors), `pnpm test:run`, `pnpm ds:validate`, `pnpm test-storybook`. Expected: all green.

- [ ] **Step 5: Commit.** `git commit -m "feat(home): group connections into sections with search"`

### Task 5: Drag cards between sections

**Files:**
- Create: `frontend/src/views/Home/dnd/card-draggable.ts`
- Create: `frontend/src/views/Home/dnd/resolve-group-drop.ts`
- Test: `frontend/src/views/Home/dnd/resolve-group-drop.test.ts`
- Modify: `HomeConnectionListItem.svelte`, `HomeConnectionList.svelte`, `Home.svelte`

**Interfaces:**
- Produces:
```ts
// resolve-group-drop.ts
export type GroupDrop = { groupId: number | null }; // null = Ungrouped
export const resolveGroupDrop: (el: Element | null) => GroupDrop | null;
// card-draggable.ts (Svelte action)
export interface CardDraggableParams {
  connectionId: number;
  onDragStart: () => void;
  onHover: (drop: GroupDrop | null) => void;
  onDrop: (drop: GroupDrop | null) => void; // null = released outside any section
}
export const cardDraggable: Action<HTMLElement, CardDraggableParams>;
```

- [ ] **Step 1: Write the failing test** (jsdom; add `// @vitest-environment jsdom` if the project default is node): build `<div data-group-drop="7"><div><span id="x"></span></div></div>` and `<div data-group-drop="ungrouped"><span id="y"></span></div>`:
  - `resolveGroupDrop(x)` → `{ groupId: 7 }`; `resolveGroupDrop(y)` → `{ groupId: null }`; an element outside both → `null`; `null` → `null`.

- [ ] **Step 2: Run it to see it fail.** `pnpm vitest run src/views/Home/dnd`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `resolveGroupDrop`** with `el.closest("[data-group-drop]")`, then run the test again. Expected: PASS.

- [ ] **Step 4: Implement `cardDraggable`.** Follow `views/Connection/DataView/components/Sidebar/dnd/draggable.ts`: pointer capture, `THRESHOLD = 4`, a ghost clone, and `document.elementFromPoint` under the pointer fed to `resolveGroupDrop`. When a drag happened, swallow the `click` that follows the `pointerup` (capture phase, once), so a drag never connects. Leave out spring-loading and auto-scroll. Apply it to each `HomeConnectionListItem` card. In `Home.svelte`, `onDrop` calls `connectionGroups.assign(id, drop.groupId)` unless the target equals the card's current `groupId`. On failure it shows an error toast titled `Failed to move connection`. `onHover` drives `isDropTarget`.

- [ ] **Step 5: Verify.** `pnpm check`, `pnpm test:run`, `pnpm test-storybook`. Expected: green.

- [ ] **Step 6: Commit.** `git commit -m "feat(home): drag connections between groups"`

### Task 6: Group field in connection settings

**Files:**
- Modify: `frontend/src/views/Connection/ConnectionDetailsView/components/ConnectionForm/ConnectionForm.svelte`
- Modify: `ConnectionForm.stories.svelte` only if the story breaks

**Interfaces:**
- Consumes: `connectionGroups` store, `assign` (Task 3).

- [ ] **Step 1: Add the select.** Add a `Select` labelled `Group` below the name field. Its options are `[null, ...group ids]`, with `getOptionLabel` returning `None` for `null` and the group name otherwise. The default is `connection.connectionDetails.groupId ?? null`, and it is `disabled={isAllFieldsDisabled}`. `onChange` calls `connectionGroups.assign(connectionId, value)` and shows an error toast on failure. It stays outside felte's `$data`, so the autosave never carries it.

- [ ] **Step 2: Verify.** `pnpm check`, `pnpm test-storybook` (the ConnectionForm story must still render; the groups store reads the mocked `GetConnectionGroups`). Expected: green.

- [ ] **Step 3: Commit.** `git commit -m "feat(connection-groups): pick a group in connection settings"`

### Task 7: Changelog and end-to-end check

**Files:**
- Modify: `frontend/src/changelog.ts` (unreleased entry, per the `changelog` skill)

- [ ] **Step 1: Add the changelog section.** Write it in the first person and the house style. Add a `thanks` link crediting KevinJoosten to https://github.com/mqtt-viewer/mqtt-viewer/issues/203, since the issue author is not the maintainer samfweb.

- [ ] **Step 2: Run the full pre-merge bar.** From the repo root: `go build ./...`, `go vet ./...`, `just test`. From `frontend/`: `pnpm check`, `pnpm test:run`, `pnpm build`, `pnpm ds:validate`, `pnpm test-storybook`. Expected: all green.

- [ ] **Step 3: Browser check in server mode.** Start with `scripts/serve-browser.sh "$(scripts/dev-ports.sh server)"`, using the steps in AGENTS.md ("Driving the app from a browser"). Then:
  - Create three connections with hosts `192.168.10.21`, `192.168.10.22` and `10.0.0.5`.
  - Create groups `Site A` and `Site B`, then drag one card into each. While dragging the last ungrouped card, the Ungrouped zone appears.
  - Fold `Site A` and restart the server. `Site A` is still folded.
  - Search `192.168.10`. `Site A` opens and shows `1 of 1`, `10.0.0.5` is hidden, and the matches are highlighted. Clear the search and `Site A` folds again.
  - Connect a grouped connection, then delete its group. The connection is in Ungrouped and still connected.
  - A short click on a card still connects.
  - Change the group in the settings form, close it, and the card is in the new section.

- [ ] **Step 4: Commit.** `git commit -m "docs(changelog): connection groups and Home search"`
