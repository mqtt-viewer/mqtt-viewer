import type { MqttData } from "../../stores/mqtt-data";
import type { MqttDataSortDirection, MqttDataSortKey } from "../../stores/sort";
import { findTopicNode } from "@/views/Connection/DataView/payload-copy";
import type { TreeRow } from "./build-tree";
import { getSortedDataKeys } from "./sort";

/**
 * One row of the pinned block. "pin" is a pinned topic at the top level of
 * the block (labelled with its full path), "descendant" is anything opened
 * beneath one (labelled with its last level, like the tree), and
 * "placeholder" is a pin nothing has published on yet.
 */
export type PinnedBlockRow =
  | (TreeRow & { kind: "pin" | "descendant" })
  | { kind: "placeholder"; topic: string };

interface BuildPinnedRowsParams {
  data: MqttData;
  /** Pins in pin order; the block keeps that order for its top level. */
  pinnedTopics: string[];
  pinnedSet: Set<string>;
  /** The pinned block's own expanded set, not the tree's. */
  expandedTopics: Set<string>;
  sortKey: MqttDataSortKey;
  sortDir: MqttDataSortDirection;
}

/**
 * Flatten the pinned block into fixed-height rows for the virtual list.
 *
 * Only expanded nodes are walked, so the cost tracks the rows that exist
 * rather than the size of the subtrees under the pins (same as buildTree).
 * Search deliberately does not filter anything here, descendants included:
 * a pin is a place you put something so you can always see it.
 */
export const buildPinnedRows = (
  params: BuildPinnedRowsParams
): PinnedBlockRow[] => {
  const { data, pinnedTopics, expandedTopics } = params;
  const result: PinnedBlockRow[] = [];
  for (const topic of pinnedTopics) {
    const node = findTopicNode(data, topic);
    if (node === null) {
      result.push({ kind: "placeholder", topic });
      continue;
    }
    const isExpanded = expandedTopics.has(topic);
    result.push({
      kind: "pin",
      levelCount: 0,
      isDecodedProto: node.isDecodedProto,
      topic,
      topicLevel: topic,
      expandKey: topic,
      message: node.message?.toString(),
      countSubtopicTotal: node.subtopicCount,
      countMessage: node.messageCount,
      isExpanded,
      isRetained: node.isRetained,
      isPinned: true,
    });
    if (isExpanded) pushChildren(result, node.children, 1, params);
  }
  return result;
};

const pushChildren = (
  result: PinnedBlockRow[],
  children: MqttData,
  levelCount: number,
  params: BuildPinnedRowsParams
) => {
  const { pinnedSet, expandedTopics, sortKey, sortDir } = params;
  for (const key of getSortedDataKeys(children, sortKey, sortDir)) {
    const node = children[key];
    const isExpanded = expandedTopics.has(node.topic);
    result.push({
      kind: "descendant",
      levelCount,
      isDecodedProto: node.isDecodedProto,
      topic: node.topic,
      topicLevel: key,
      expandKey: node.topic,
      message: node.message?.toString(),
      countSubtopicTotal: node.subtopicCount,
      countMessage: node.messageCount,
      isExpanded,
      isRetained: node.isRetained,
      isPinned: pinnedSet.has(node.topic),
    });
    if (isExpanded) pushChildren(result, node.children, levelCount + 1, params);
  }
};
