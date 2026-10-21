import type { Connection } from "@/stores/connections";
import type { ConnectionGroup } from "bindings/mqtt-viewer/backend/models/models";
import { filterConnections } from "@/views/NewTab/helpers/filter";

export interface HomeSection {
  group: ConnectionGroup | null; // null = Ungrouped
  connections: Connection[]; // matches only, in Home order
  total: number; // all connections in the section, ignoring search
  open: boolean; // render the card grid
}

export const sortForHome = (connections: Connection[]): Connection[] =>
  [...connections].sort((a, b) => {
    if (!a.connectionDetails.lastConnectedAt) {
      return 1;
    }
    if (!b.connectionDetails.lastConnectedAt) {
      return -1;
    }
    if (a.connectionState == "connected" && b.connectionState != "connected") {
      return -1;
    }
    if (a.connectionState != "connected" && b.connectionState == "connected") {
      return 1;
    }
    return (
      b.connectionDetails.lastConnectedAt.getTime() -
      a.connectionDetails.lastConnectedAt.getTime()
    );
  });

// With no groups the section is simply every connection, as Home always read.
export const ungroupedLabel = (groups: ConnectionGroup[]): string =>
  groups.length === 0 ? "All connections" : "Ungrouped";

// The Ungrouped section that exists only as a drag-time drop zone (no cards)
// is split off so Home can float it over the header bar instead of the list.
export const splitDropZone = (
  sections: HomeSection[]
): { zone: HomeSection | null; rest: HomeSection[] } => {
  const [first, ...rest] = sections;
  return first && first.group === null && first.connections.length === 0
    ? { zone: first, rest }
    : { zone: null, rest: sections };
};

export const buildHomeSections = ({
  connections,
  groups,
  search,
  isDragging,
}: {
  connections: Connection[];
  groups: ConnectionGroup[];
  search: string;
  isDragging: boolean;
}): HomeSection[] => {
  const term = search.trim();
  const searching = term !== "";
  const sorted = sortForHome(connections);
  const groupIds = new Set(groups.map((g) => g.id));
  const bucket = (group: ConnectionGroup | null) =>
    sorted.filter((c) => {
      const id = c.connectionDetails.groupId;
      return group ? id === group.id : id == null || !groupIds.has(id);
    });

  const sections = [null, ...groups].map((group) => {
    const all = bucket(group);
    return {
      group,
      connections: filterConnections(all, term),
      total: all.length,
      open: searching ? true : !group?.collapsed,
    };
  });

  return sections.filter((s, i) => {
    if (i === 0 && isDragging) return true;
    if (searching) return s.connections.length > 0;
    if (i > 0) return true;
    return s.total > 0 || groups.length === 0;
  });
};
