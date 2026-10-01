import type { MqttData } from "./mqtt-data";

// Kept apart from mqtt-data.ts so pure helpers (payload-copy, the tree
// builders) can use these without pulling in the Wails runtime.

/**
 * A new, empty level map. Topic levels are whatever a publisher sends, so a
 * level may well be "__proto__", "constructor" or "toString". With no
 * prototype those are ordinary keys: lookups cannot find an inherited member
 * and assignments cannot reach Object.prototype. Every level map the store
 * creates must come from here.
 */
export const emptyMqttData = (): MqttData => Object.create(null);

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * The child at `level`, or undefined. Own properties only, so this is safe on
 * any MqttData, including hand-built plain objects (fixtures, stories) that
 * still inherit from Object.prototype.
 */
export const getMqttDataChild = (
  data: MqttData,
  level: string
): MqttData[string] | undefined =>
  hasOwn.call(data, level) ? data[level] : undefined;
