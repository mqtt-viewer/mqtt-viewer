// Flattens the Sparkplug tree state into virtualized rows, mirroring the
// topic tree's build-tree.ts. Group and node (and device) rows carry an
// expansion key; expansion state is a set of COLLAPSED keys so everything
// defaults to expanded.

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
  /** Keys the user collapsed (default expanded). */
  collapsedKeys: Set<string>;
  /** Case-insensitive substring filter on node/device/metric/group names. */
  filter: string;
}

const matches = (name: string, filter: string) =>
  name.toLowerCase().includes(filter);

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
  const { groups, collapsedKeys } = params;
  const filter = params.filter.trim().toLowerCase();
  const result: SparkplugTreeRow[] = [];

  for (const group of groups) {
    const groupKey = group.name;
    const groupMatched = filter === "" || matches(group.name, filter);
    const groupStart = result.length;
    const groupExpanded = !collapsedKeys.has(groupKey);
    result.push({
      kind: "group",
      key: groupKey,
      levelCount: 0,
      isExpanded: groupExpanded,
      group,
    });

    if (groupExpanded) {
      for (const node of group.nodes) {
        const nodeKey = `${group.name}/${node.name}`;
        const nodeMatched = groupMatched || matches(node.name, filter);
        const nodeStart = result.length;
        const nodeExpanded = !collapsedKeys.has(nodeKey);
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
            const deviceExpanded = !collapsedKeys.has(deviceKey);
            result.push({
              kind: "device",
              key: deviceKey,
              levelCount: 2,
              isExpanded: deviceExpanded,
              node,
              device,
            });
            if (deviceExpanded) {
              pushMetrics(
                result,
                deviceKey,
                device.metrics,
                3,
                filter,
                deviceMatched
              );
            }
            // Drop a device row that neither matched nor kept any children.
            if (
              filter !== "" &&
              !deviceMatched &&
              result.length === deviceStart + 1
            ) {
              result.length = deviceStart;
            }
          }
        }
        // Drop a node row that neither matched nor kept any children (a
        // collapsed node stays visible only when it matches directly).
        if (filter !== "" && !nodeMatched && result.length === nodeStart + 1) {
          result.length = nodeStart;
        }
      }
    }
    if (filter !== "" && !groupMatched && result.length === groupStart + 1) {
      result.length = groupStart;
    }
  }
  return result;
};

/**
 * Single-unit relative age: "2s", "4m", "3h", "2d". Used for metric last-seen
 * and death ages. (No existing util covers single-unit relative times;
 * humanizeDuration in sys-metrics is two-unit and lives in the broker-status
 * view.)
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

/** JSON of {name, type, value} rows for "Copy metric list". */
export const metricListJson = (node: SparkplugNode): string => {
  const rows = node.metrics.map((m) => ({
    name: m.name,
    type: m.typeName,
    value: m.valueRaw,
  }));
  for (const device of node.devices) {
    for (const m of device.metrics) {
      rows.push({
        name: `${device.name}/${m.name}`,
        type: m.typeName,
        value: m.valueRaw,
      });
    }
  }
  return JSON.stringify(rows, null, 2);
};
