import type { PublishHistory } from "../../PublishPanel/stores/publish-history";

// A history entry as collection-message save params, named after its topic.
// Used by the history row's "Add to collection" menu and by dropping a history
// row into a folder.
export const historyEntryToMessage = (
  entry: PublishHistory[number],
  collectionId: number
) => ({
  collectionId,
  name: entry.topic || "Untitled message",
  topic: entry.topic,
  payload: entry.payload,
  qos: entry.qos,
  retain: entry.retain,
  encoding: entry.encoding,
  format: entry.format,
  userProperties: entry.userProperties,
  headerContentType: entry.headerContentType,
  headerResponseTopic: entry.headerResponseTopic,
  headerCorrelationData: entry.headerCorrelationData,
  headerPayloadFormatIndicator: entry.headerPayloadFormatIndicator,
  headerMessageExpiryInterval: entry.headerMessageExpiryInterval,
  headerTopicAlias: entry.headerTopicAlias,
  headerSubscriptionIdentifier: entry.headerSubscriptionIdentifier,
});
