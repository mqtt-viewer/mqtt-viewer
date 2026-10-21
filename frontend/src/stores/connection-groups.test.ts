import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectionGroups: vi.fn(),
  newConnectionGroup: vi.fn(),
  renameConnectionGroup: vi.fn(),
  setConnectionGroupCollapsed: vi.fn(),
  deleteConnectionGroup: vi.fn(),
  setConnectionGroup: vi.fn(),
  setGroupLocally: vi.fn(),
  connectionsState: { connections: {} as Record<number, any> },
}));

vi.mock("bindings/mqtt-viewer/backend/app/app", () => ({
  GetConnectionGroups: (...a: unknown[]) => mocks.getConnectionGroups(...a),
  NewConnectionGroup: (...a: unknown[]) => mocks.newConnectionGroup(...a),
  RenameConnectionGroup: (...a: unknown[]) =>
    mocks.renameConnectionGroup(...a),
  SetConnectionGroupCollapsed: (...a: unknown[]) =>
    mocks.setConnectionGroupCollapsed(...a),
  DeleteConnectionGroup: (...a: unknown[]) => mocks.deleteConnectionGroup(...a),
  SetConnectionGroup: (...a: unknown[]) => mocks.setConnectionGroup(...a),
}));

vi.mock("@/stores/connections", () => ({
  default: {
    subscribe: (fn: (v: unknown) => void) => {
      fn(mocks.connectionsState);
      return () => {};
    },
    setGroupLocally: (...a: unknown[]) => mocks.setGroupLocally(...a),
  },
}));

const group = (id: number, name: string, collapsed = false) => ({
  id,
  name,
  collapsed,
  createdAt: "",
  updatedAt: "",
});

const names = (store: { subscribe: any }) =>
  (get(store as any) as { name: string }[]).map((g) => g.name);

const loadStore = async (groups = [group(1, "Alpha"), group(3, "Gamma")]) => {
  vi.resetModules();
  mocks.getConnectionGroups.mockResolvedValue(groups);
  const store = (await import("./connection-groups")).default;
  await store.init();
  return store;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectionsState = { connections: {} };
});

describe("connection groups store", () => {
  it("init loads groups", async () => {
    const store = await loadStore();
    expect(get(store)).toEqual([group(1, "Alpha"), group(3, "Gamma")]);
  });

  it("create inserts alphabetically", async () => {
    const store = await loadStore();
    mocks.newConnectionGroup.mockResolvedValue(group(2, "Beta"));
    const created = await store.create("Beta");
    expect(created).toEqual(group(2, "Beta"));
    expect(names(store)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("rename re-sorts and keeps the backend's trimmed name", async () => {
    const store = await loadStore();
    mocks.renameConnectionGroup.mockResolvedValue(group(1, "Zeta"));
    await store.rename(1, "  Zeta  ");
    expect(mocks.renameConnectionGroup).toHaveBeenCalledWith(1, "  Zeta  ");
    expect(names(store)).toEqual(["Gamma", "Zeta"]);
  });

  it("remove clears groupId on that group's connections", async () => {
    const store = await loadStore();
    mocks.connectionsState = {
      connections: {
        10: { connectionDetails: { id: 10, groupId: 1 } },
        11: { connectionDetails: { id: 11, groupId: 3 } },
        12: { connectionDetails: { id: 12, groupId: 1 } },
        13: { connectionDetails: { id: 13, groupId: null } },
      },
    };
    mocks.deleteConnectionGroup.mockResolvedValue(undefined);
    await store.remove(1);
    expect(mocks.deleteConnectionGroup).toHaveBeenCalledWith(1);
    expect(mocks.setGroupLocally).toHaveBeenCalledWith([10, 12], null);
    expect(names(store)).toEqual(["Gamma"]);
  });

  it("assign persists then updates the connection locally", async () => {
    const store = await loadStore();
    mocks.setConnectionGroup.mockResolvedValue(undefined);
    await store.assign(10, 3);
    expect(mocks.setConnectionGroup).toHaveBeenCalledWith(10, 3);
    expect(mocks.setGroupLocally).toHaveBeenCalledWith([10], 3);
  });

  it("assign leaves the connection alone and rethrows when the backend rejects", async () => {
    const store = await loadStore();
    const failure = new Error("nope");
    mocks.setConnectionGroup.mockRejectedValue(failure);
    await expect(store.assign(10, 3)).rejects.toBe(failure);
    expect(mocks.setGroupLocally).not.toHaveBeenCalled();
  });

  it("setCollapsed updates the group in place and persists", async () => {
    const store = await loadStore();
    mocks.setConnectionGroupCollapsed.mockResolvedValue(undefined);
    await store.setCollapsed(3, true);
    expect(mocks.setConnectionGroupCollapsed).toHaveBeenCalledWith(3, true);
    expect(get(store)).toEqual([group(1, "Alpha"), group(3, "Gamma", true)]);
  });
});
