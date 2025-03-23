import type { MqttData } from "../../stores/mqtt-data";
import type { MqttDataSortDirection, MqttDataSortKey } from "../../stores/sort";
import { filterData } from "./filter";
import { getSortedDataKeys } from "./sort";

export type TreeRow = {
  levelCount: number;
  isDecodedProto: boolean;
  topicLevel: string;
  topic: string;
  expandKey: string;
  isExpanded: boolean;
  countSubtopicTotal: number;
  countMessage: number;
  message?: string;
};

interface BuildTreeParams {
  data: MqttData;
  expandedTopics: Set<string>;
  sortKey: MqttDataSortKey;
  sortDir: MqttDataSortDirection;
  searchText: string;
}

export const buildTree = (params: BuildTreeParams) => {
  let result: TreeRow[] = [];
  buildRows({
    result,
    levelCount: 0,
    ...params,
  });

  return result;
};

interface BuildRowParams {
  result: TreeRow[];
  data: MqttData;
  expandedTopics: Set<string>;
  levelCount: number;
  sortKey: MqttDataSortKey;
  sortDir: MqttDataSortDirection;
  searchText: string;
}
const buildRows = (params: BuildRowParams) => {
  const {
    result,
    data,
    expandedTopics,
    levelCount,
    sortKey,
    sortDir,
    searchText,
  } = params;
  const filteredData = filterData(data, searchText);
  const sortedDataKeys = getSortedDataKeys(filteredData, sortKey, sortDir);
  for (const key of sortedDataKeys) {
    const topicData = filteredData[key];
    const expandKey = topicData.topic;
    const thisRowIsExpanded = expandedTopics.has(expandKey) ?? false;
    result.push({
      levelCount,
      isDecodedProto: topicData.isDecodedProto,
      topic: topicData.topic,
      topicLevel: key,
      expandKey,
      message: topicData.message?.toString(),
      countSubtopicTotal: topicData.subtopicCount,
      countMessage: topicData.messageCount,
      isExpanded: thisRowIsExpanded,
    });

    if (thisRowIsExpanded) {
      buildRows({
        result,
        data: topicData.children,
        expandedTopics,
        levelCount: levelCount + 1,
        sortKey,
        sortDir,
        searchText,
      });
    }
  }
};
