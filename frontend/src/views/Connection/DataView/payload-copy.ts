import { formatPayload } from "@/components/CodeEditor/formatting";
import type { MqttData } from "./components/MqttDataPanel/stores/mqtt-data";

/**
 * Shared payload-copy rules for the list tree, the graph, and the
 * selected-topic panel, so the three surfaces produce the same text.
 */

/**
 * Format a payload the way the selected-topic panel does by default: JSON is
 * pretty-printed, anything else is copied as-is. Mirrors the auto-format effect
 * in SelectedTopicPanel.
 */
export const formatPayloadForCopy = (payload: string): string => {
  try {
    JSON.parse(payload);
  } catch {
    return payload;
  }
  return formatPayload(payload, "json-prettier");
};

/** Walk a full topic path to its node, or null if it isn't in the tree. */
const findTopicNode = (
  data: MqttData,
  topic: string
): MqttData[string] | null => {
  const levels = topic.split("/");
  let current: MqttData | undefined = data;
  for (let i = 0; i < levels.length; i++) {
    const node: MqttData[string] | undefined = current?.[levels[i]];
    if (node === undefined) return null;
    if (i === levels.length - 1) return node;
    current = node.children;
  }
  return null;
};

/**
 * Find a topic's latest payload in the tree store.
 *
 * The store caches the payload already utf8-decoded by the same path the
 * selected-topic store uses, and protobuf/Sparkplug payloads are decoded to
 * JSON in Go before they ever reach us. So this needs no fetch and no bridge
 * call, which is what makes it cheap enough to run when a context menu opens.
 *
 * Returns null for a topic with no value of its own (an intermediate branch
 * node) or one that isn't in the tree.
 */
export const findTopicPayload = (
  data: MqttData,
  topic: string
): string | null => findTopicNode(data, topic)?.message ?? null;

/**
 * Whether a topic holds a retained message, as far as the tree store knows.
 * Used to decide whether the clear action is enabled. The backend is
 * authoritative for counting and clearing; this only drives the menu.
 */
export const findTopicIsRetained = (data: MqttData, topic: string): boolean =>
  findTopicNode(data, topic)?.isRetained ?? false;
