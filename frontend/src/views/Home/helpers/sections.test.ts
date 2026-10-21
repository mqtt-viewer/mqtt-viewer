import { describe, expect, it } from "vitest";
import type { Connection } from "@/stores/connections";
import type { ConnectionGroup } from "bindings/mqtt-viewer/backend/models/models";
import {
  buildHomeSections,
  sortForHome,
  splitDropZone,
  ungroupedLabel,
} from "./sections";

const conn = (
  id: number,
  o: {
    host?: string;
    groupId?: number | null;
    lastConnectedAt?: Date | null;
    state?: string;
  } = {}
) =>
  ({
    connectionDetails: {
      id,
      name: `conn-${id}`,
      host: o.host ?? `10.0.0.${id}`,
      groupId: o.groupId ?? null,
      lastConnectedAt: o.lastConnectedAt ?? null,
    },
    connectionString: `mqtt://${o.host ?? `10.0.0.${id}`}:1883`,
    connectionState: o.state ?? "disconnected",
  }) as unknown as Connection;

const group = (id: number, name: string, collapsed = false) =>
  ({ id, name, collapsed }) as ConnectionGroup;

const A = group(1, "A");
const B = group(2, "B");
const ids = (sections: { group: ConnectionGroup | null }[]) =>
  sections.map((s) => s.group?.id ?? null);
const build = (
  connections: Connection[],
  groups: ConnectionGroup[],
  search = "",
  isDragging = false
) => buildHomeSections({ connections, groups, search, isDragging });

describe("sortForHome", () => {
  it("keeps today's Home order", () => {
    const old = conn(1, { lastConnectedAt: new Date(2020, 0, 1) });
    const recent = conn(2, { lastConnectedAt: new Date(2024, 0, 1) });
    const never = conn(3);
    const live = conn(4, {
      lastConnectedAt: new Date(2019, 0, 1),
      state: "connected",
    });
    const input = [never, old, recent, live];
    const sorted = sortForHome(input);
    expect(sorted.map((c) => c.connectionDetails.id)).toEqual([4, 2, 1, 3]);
    expect(input.map((c) => c.connectionDetails.id)).toEqual([3, 1, 2, 4]);
  });
});

describe("buildHomeSections", () => {
  it("puts ungrouped first, then groups in the given order", () => {
    const s = build([conn(1), conn(2, { groupId: 1 }), conn(3, { groupId: 2 })], [A, B]);
    expect(ids(s)).toEqual([null, 1, 2]);
  });

  it("hides Ungrouped when empty unless it is the only section", () => {
    expect(ids(build([conn(1, { groupId: 1 })], [A]))).toEqual([1]);
    expect(ids(build([], []))).toEqual([null]);
  });

  it("shows an empty Ungrouped while dragging", () => {
    const s = build([conn(1, { groupId: 1 })], [A], "", true);
    expect(ids(s)).toEqual([null, 1]);
    expect(s[0].total).toBe(0);
    expect(s[0].connections).toEqual([]);
  });

  it("shows empty groups when not searching", () => {
    const s = build([conn(1)], [A, B]);
    const b = s.find((x) => x.group?.id === 2)!;
    expect(b.total).toBe(0);
    expect(b.connections).toEqual([]);
  });

  it("opens sections according to collapsed when not searching", () => {
    const s = build([conn(1, { groupId: 1 })], [group(1, "A", true)]);
    expect(s[0].open).toBe(false);
    expect(build([conn(1, { groupId: 1 })], [A])[0].open).toBe(true);
  });

  it("filters cards and hides sections without matches when searching", () => {
    const conns = [
      conn(1, { groupId: 1, host: "192.168.10.1" }),
      conn(2, { groupId: 1, host: "10.1.1.1" }),
      conn(3, { groupId: 2, host: "10.2.2.2" }),
      conn(4, { host: "10.3.3.3" }),
    ];
    const s = build(conns, [A, B], "192.168.10");
    expect(ids(s)).toEqual([1]);
    expect(s[0].connections.map((c) => c.connectionDetails.id)).toEqual([1]);
    expect(s[0].total).toBe(2);
  });

  it("shows Ungrouped while dragging during a search", () => {
    const conns = [
      conn(1, { groupId: 1, host: "192.168.10.1" }),
      conn(2, { host: "10.3.3.3" }),
    ];
    const s = build(conns, [A], "192.168.10", true);
    expect(ids(s)).toEqual([null, 1]);
    expect(s[0].connections).toEqual([]);
    expect(s[0].total).toBe(1);
  });

  it("opens collapsed sections that have matches when searching", () => {
    const s = build(
      [conn(1, { groupId: 1, host: "192.168.10.1" })],
      [group(1, "A", true)],
      "192.168.10"
    );
    expect(s[0].open).toBe(true);
  });

  it("trims the search", () => {
    const conns = [
      conn(1, { groupId: 1, host: "192.168.10.1" }),
      conn(2, { groupId: 2, host: "10.2.2.2" }),
    ];
    expect(build(conns, [A, B], "  192.168.10 ")).toEqual(
      build(conns, [A, B], "192.168.10")
    );
    expect(build(conns, [A, B], "   ")).toEqual(build(conns, [A, B], ""));
  });

  it("shows a connection whose group does not exist as Ungrouped", () => {
    const s = build([conn(1, { groupId: 99 })], [A]);
    expect(ids(s)).toEqual([null, 1]);
    expect(s[0].connections.map((c) => c.connectionDetails.id)).toEqual([1]);
  });

  it("keeps Home order inside each section", () => {
    const old = conn(1, { groupId: 1, lastConnectedAt: new Date(2020, 0, 1) });
    const recent = conn(2, { groupId: 1, lastConnectedAt: new Date(2024, 0, 1) });
    const s = build([old, recent], [A]);
    expect(s[0].connections.map((c) => c.connectionDetails.id)).toEqual([2, 1]);
  });
});

describe("splitDropZone", () => {
  it("floats the drag-only empty Ungrouped section", () => {
    const sections = build([conn(1, { groupId: 1 })], [A], "", true);
    const { zone, rest } = splitDropZone(sections);
    expect(zone?.group).toBeNull();
    expect(ids(rest)).toEqual([1]);
  });

  it("floats it when a search hides every Ungrouped match mid-drag", () => {
    const conns = [conn(1), conn(2, { groupId: 1, host: "192.168.1.1" })];
    const { zone, rest } = splitDropZone(build(conns, [A], "192.168", true));
    expect(zone?.total).toBe(1);
    expect(ids(rest)).toEqual([1]);
  });

  it("keeps a non-empty Ungrouped section in flow", () => {
    const sections = build([conn(1), conn(2, { groupId: 1 })], [A], "", true);
    const { zone, rest } = splitDropZone(sections);
    expect(zone).toBeNull();
    expect(rest).toBe(sections);
  });

  it("leaves sections alone when there is no Ungrouped section", () => {
    const sections = build([conn(1, { groupId: 1 })], [A]);
    expect(splitDropZone(sections)).toEqual({ zone: null, rest: sections });
  });
});

describe("ungroupedLabel", () => {
  it("keeps the old Home heading until a group exists", () => {
    expect(ungroupedLabel([])).toBe("All connections");
    expect(ungroupedLabel([A])).toBe("Ungrouped");
  });
});
