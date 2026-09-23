// Flattens the Sparkplug tree state into virtualised rows, mirroring the
// topic tree's build-tree.ts. Group, node and device rows carry an expansion
// key. Groups default open; nodes and devices follow a default the panel
// picks from the fleet size, and the user's own clicks override it per key.

import type {
  SparkplugDevice,
  SparkplugGroup,
  SparkplugMetric,
  SparkplugNode,
} from "../../stores/sparkplug-tree-store";

export type SparkplugRowKind = "group" | "node" | "device" | "metric";

export interface SparkplugTreeRow {
  kind: SparkplugRowKind;
  /** Expansion key for group/node/device rows: "group[/node[/device]]". */
  key: string;
  levelCount: number;
  isExpanded: boolean;
  group?: SparkplugGroup;
  node?: SparkplugNode;
  device?: SparkplugDevice;
  metric?: SparkplugMetric;
}

interface BuildParams {
  groups: SparkplugGroup[];
  /** Explicit expand (true) or collapse (false) choices by key. */
  expansion: Map<string, boolean>;
  /** Whether node and device rows start open. Groups always do. */
  defaultExpanded: boolean;
  /**
   * Case-insensitive substring filter on group/node/device/metric names.
   * While it is set everything is shown open, so matches are never hidden
   * under a collapsed row.
   */
  filter: string;
  /** Only nodes that need attention (see nodeProblems). */
  problemsOnly: boolean;
}

const matches = (name: string, filter: string) =>
  name.toLowerCase().includes(filter);

export const nodeKeyOf = (group: string, node: string) => `${group}/${node}`;

/**
 * What needs attention on a node, in the order it is worth reading. Empty
 * when the node is healthy.
 */
export const nodeProblems = (node: SparkplugNode): string[] => {
  const problems: string[] = [];
  if (node.status === "offline") problems.push("offline");
  if (node.storm) problems.push("rebirth storm");
  if (!node.seqOk) problems.push("seq gap");
  const unresolved =
    node.placeholderCount > 0 || node.devices.some((d) => d.placeholderCount > 0);
  if (unresolved) problems.push("unresolved aliases");
  else if (node.hasBirth && !node.verified) problems.push("names unverified");
  if (node.devices.some((d) => d.status === "offline")) problems.push("device offline");
  if (node.devices.some((d) => d.awaitingBirth)) problems.push("device awaiting birth");
  return problems;
};

/** A node whose metrics show aliases, not names, and a rebirth would fix. */
export const needsRebirth = (node: SparkplugNode): boolean =>
  node.status !== "offline" &&
  (node.placeholderCount > 0 ||
    node.devices.some((d) => d.placeholderCount > 0) ||
    (node.hasBirth && !node.verified));

const pushMetrics = (
  result: SparkplugTreeRow[],
  key: string,
  metrics: SparkplugMetric[],
  levelCount: number,
  filter: string,
  parentMatched: boolean
) => {
  for (const metric of metrics) {
    if (filter !== "" && !parentMatched && !matches(metric.name, filter)) {
      continue;
    }
    result.push({ kind: "metric", key, levelCount, isExpanded: false, metric });
  }
};

export const buildSparkplugTree = (params: BuildParams): SparkplugTreeRow[] => {
  const { groups, expansion, defaultExpanded, problemsOnly } = params;
  const filter = params.filter.trim().toLowerCase();
  const filtering = filter !== "";
  const isOpen = (key: string, fallback: boolean) =>
    filtering || (expansion.get(key) ?? fallback);
  const result: SparkplugTreeRow[] = [];

  for (const group of groups) {
    const groupKey = group.name;
    const groupMatched = !filtering || matches(group.name, filter);
    const groupStart = result.length;
    const groupExpanded = isOpen(groupKey, true);
    result.push({
      kind: "group",
      key: groupKey,
      levelCount: 0,
      isExpanded: groupExpanded,
      group,
    });

    let keptNodes = 0;
    for (const node of group.nodes) {
      if (problemsOnly && nodeProblems(node).length === 0) continue;
      const nodeMatched = groupMatched || matches(node.name, filter);
      if (!groupExpanded) {
        // Collapsed (never while filtering): count what the group holds so
        // the problems filter can still drop a group with nothing to show.
        keptNodes++;
        continue;
      }
      const nodeKey = nodeKeyOf(group.name, node.name);
      const nodeStart = result.length;
      const nodeExpanded = isOpen(nodeKey, defaultExpanded);
      result.push({
        kind: "node",
        key: nodeKey,
        levelCount: 1,
        isExpanded: nodeExpanded,
        node,
      });

      if (nodeExpanded) {
        pushMetrics(result, nodeKey, node.metrics, 2, filter, nodeMatched);
        for (const device of node.devices) {
          const deviceKey = `${nodeKey}/${device.name}`;
          const deviceMatched = nodeMatched || matches(device.name, filter);
          const deviceStart = result.length;
          const deviceExpanded = isOpen(deviceKey, defaultExpanded);
          result.push({
            kind: "device",
            key: deviceKey,
            levelCount: 2,
            isExpanded: deviceExpanded,
            node,
            device,
          });
          if (deviceExpanded) {
            pushMetrics(result, deviceKey, device.metrics, 3, filter, deviceMatched);
          }
          // Drop a device row that neither matched nor kept any children.
          if (filtering && !deviceMatched && result.length === deviceStart + 1) {
            result.length = deviceStart;
          }
        }
      }
      // Drop a node row that neither matched nor kept any children.
      if (filtering && !nodeMatched && result.length === nodeStart + 1) {
        result.length = nodeStart;
        continue;
      }
      keptNodes++;
    }
    // A group left with no nodes under the filter goes too.
    if ((filtering || problemsOnly) && keptNodes === 0) result.length = groupStart;
  }
  return result;
};

/** Every expandable key in the tree, for expand-all. */
export const allExpansionKeys = (groups: SparkplugGroup[]): string[] => {
  const keys: string[] = [];
  for (const group of groups) {
    keys.push(group.name);
    for (const node of group.nodes) {
      const nodeKey = nodeKeyOf(group.name, node.name);
      keys.push(nodeKey);
      for (const device of node.devices) keys.push(`${nodeKey}/${device.name}`);
    }
  }
  return keys;
};

/** Total metric rows if everything were open, to pick the default. */
export const totalMetricCount = (groups: SparkplugGroup[]): number => {
  let n = 0;
  for (const group of groups) {
    for (const node of group.nodes) {
      n += node.metrics.length;
      for (const device of node.devices) n += device.metrics.length;
    }
  }
  return n;
};

/**
 * Single-unit relative age: "2s", "4m", "3h", "2d". Used for metric last-seen
 * and death ages.
 */
export const formatAge = (ms: number, nowMs: number): string => {
  const s = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

/** Wall-clock HH:MM:SS for warning rows and the host "since" column. */
export const formatClockTime = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** JSON of {name, type, value, unit} rows for "Copy metric list". */
export const metricListJson = (node: SparkplugNode): string => {
  const row = (name: string, m: SparkplugMetric) => ({
    name,
    type: m.typeName,
    value: m.valueRaw,
    ...(m.unit ? { unit: m.unit } : {}),
  });
  const rows = node.metrics.map((m) => row(m.name, m));
  for (const device of node.devices) {
    for (const m of device.metrics) rows.push(row(`${device.name}/${m.name}`, m));
  }
  return JSON.stringify(rows, null, 2);
};
