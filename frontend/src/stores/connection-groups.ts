import { get, writable } from "svelte/store";
import {
  DeleteConnectionGroup,
  GetConnectionGroups,
  NewConnectionGroup,
  RenameConnectionGroup,
  SetConnectionGroup,
  SetConnectionGroupCollapsed,
} from "bindings/mqtt-viewer/backend/app/app";
import type { ConnectionGroup } from "bindings/mqtt-viewer/backend/models/models";
import connections from "@/stores/connections";

// User-made Home groups, kept alphabetical (the backend returns them sorted;
// create and rename re-sort locally).
const { subscribe, set, update } = writable<ConnectionGroup[]>([]);

const sorted = (groups: ConnectionGroup[]) =>
  [...groups].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

const init = async () => {
  set((await GetConnectionGroups()) ?? []);
};

const create = async (name: string) => {
  const created = await NewConnectionGroup(name);
  update((groups) => sorted([...groups, created]));
  return created;
};

const rename = async (id: number, name: string) => {
  const renamed = await RenameConnectionGroup(id, name);
  update((groups) => sorted(groups.map((g) => (g.id === id ? renamed : g))));
};

const remove = async (id: number) => {
  // The backend ungroups the members; mirror that locally.
  const memberIds = Object.values(get(connections).connections)
    .filter((c) => c.connectionDetails.groupId === id)
    .map((c) => c.connectionDetails.id);
  await DeleteConnectionGroup(id);
  connections.setGroupLocally(memberIds, null);
  update((groups) => groups.filter((g) => g.id !== id));
};

const setCollapsed = async (id: number, collapsed: boolean) => {
  await SetConnectionGroupCollapsed(id, collapsed);
  update((groups) => groups.map((g) => (g.id === id ? { ...g, collapsed } : g)));
};

const assign = async (connectionId: number, groupId: number | null) => {
  await SetConnectionGroup(connectionId, groupId);
  connections.setGroupLocally([connectionId], groupId);
};

export default { subscribe, init, create, rename, remove, setCollapsed, assign };
