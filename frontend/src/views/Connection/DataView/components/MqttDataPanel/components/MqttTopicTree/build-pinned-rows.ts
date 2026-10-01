import type { MqttData } from "../../stores/mqtt-data";
import type { MqttDataSortDirection, MqttDataSortKey } from "../../stores/sort";
import { findTopicNode } from "@/views/Connection/DataView/payload-copy";
import { topicMatchesQuery } from "@/util/topic-filter";
import type { TreeRow } from "./build-tree";
import { filterData } from "./filter";
import { getSortedDataKeys } from "./sort";
import {
  expandedUnder,
  type PinnedExpansion,
} from "@/views/Connection/DataView/stores/pinned-expansion";

/**
 * One row of the pinned block. "pin" is a pinned topic at the top level of
 * the block (labelled with its full path), "descendant" is anything opened
 * beneath one (labelled with its last level, like the tree), and
 * "placeholder" is a pin nothing has published on yet.
 *
 * `pinRoot` is the pin a row sits under (a pin row's is itself). Expansion is
 * kept per pin, since one topic can show under two pins, so it is what a row
 * toggles against.
 */
export type PinnedBlockRow =
  | (TreeRow & { kind: "pin" | "descendant"; pinRoot: string })
  | { kind: "placeholder"; topic: string };

interface BuildPinnedRowsParams {
  data: MqttData;
  /** Pins in pin order; the block keeps that order for its top level. */
  pinnedTopics: string[];
  pinnedSet: Set<string>;
  /** The pinned block's own expansion, per pin, not the tree's. */
  expansion: PinnedExpansion;
  sortKey: MqttDataSortKey;
  sortDir: MqttDataSortDirection;
  /** The tree's search text; the block filters exactly as the tree does. */
  searchText: string;
}

/**
 * Flatten the pinned block into fixed-height rows for the virtual list.
 *
 * With no search, only expanded nodes are walked, so the cost tracks the rows
 * that exist rather than the size of the subtrees under the pins (same as
 * buildTree). A search filters the block the way it filters the tree: a pin
 * stays while its own path or payload matches or anything beneath it does,
 * and what shows beneath it is pruned and counted with the tree's own
 * filterData. Like the tree, a search opens nothing; it only hides.
 */
export const buildPinnedRows = (
  params: BuildPinnedRowsParams
): PinnedBlockRow[] => {
  const { data, pinnedTopics, expansion, searchText } = params;
  const result: PinnedBlockRow[] = [];
  for (const topic of pinnedTopics) {
    const found = findTopicNode(data, topic);
    if (found === null) {
      // Nothing has arrived, so there is no payload to match: the path is all
      // there is.
      if (!searchText || topicMatchesQuery(topic, searchText, [])) {
        result.push({ kind: "placeholder", topic });
      }
      continue;
    }
    const node = searchText ? filterPin(found, searchText) : found;
    if (node === null) continue;
    const expanded = expandedUnder(expansion, topic);
    const isExpanded = expanded.has(topic);
    result.push({
      kind: "pin",
      pinRoot: topic,
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
    if (isExpanded) {
      pushChildren(result, node.children, 1, topic, expanded, params);
    }
  }
  return result;
};

/**
 * The pin's node as the tree would show it under a search, or null when
 * neither it nor anything beneath it matches. filterData works on a level, so
 * the node goes in as a level of one; it matches on the node's full topic,
 * which for a pin row is also what the row shows.
 */
const filterPin = (
  node: MqttData[string],
  searchText: string
): MqttData[string] | null => {
  // Null prototype, like the store's own levels: the key is a topic and
  // could be "__proto__".
  const level: MqttData = Object.create(null);
  level[node.topic] = node;
  const filtered = filterData(level, searchText);
  return Object.prototype.hasOwnProperty.call(filtered, node.topic)
    ? filtered[node.topic]
    : null;
};

const pushChildren = (
  result: PinnedBlockRow[],
  children: MqttData,
  levelCount: number,
  pinRoot: string,
  expanded: ReadonlySet<string>,
  params: BuildPinnedRowsParams
) => {
  // Already pruned by filterPin when a search is on, so nothing to filter
  // here.
  const { pinnedSet, sortKey, sortDir } = params;
  for (const key of getSortedDataKeys(children, sortKey, sortDir)) {
    const node = children[key];
    const isExpanded = expanded.has(node.topic);
    result.push({
      kind: "descendant",
      pinRoot,
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
    if (isExpanded) {
      pushChildren(
        result,
        node.children,
        levelCount + 1,
        pinRoot,
        expanded,
        params
      );
    }
  }
};
