import { describe, it, expect } from "vitest";
import {
  findTopicIsRetained,
  findTopicPayload,
  formatPayloadForCopy,
} from "./payload-copy";
import type { MqttData } from "./components/MqttDataPanel/stores/mqtt-data";

const node = (
  topic: string,
  overrides: Partial<MqttData[string]> = {}
): MqttData[string] => ({
  subtopicCount: 0,
  messageCount: 1,
  topic,
  latestMessageTime: new Date(0),
  message: undefined,
  isDecodedProto: false,
  isRetained: false,
  children: {},
  ...overrides,
});

// home/a  -> leaf with a payload, retained
// home/b  -> leaf with a payload, not retained
// home     -> intermediate level, no payload of its own
const data: MqttData = {
  home: node("home", {
    subtopicCount: 2,
    children: {
      a: node("home/a", { message: '{"v":1}', isRetained: true }),
      b: node("home/b", { message: "plain text" }),
    },
  }),
};

describe("findTopicPayload", () => {
  it("finds a leaf payload", () => {
    expect(findTopicPayload(data, "home/a")).toBe('{"v":1}');
  });

  it("returns null for an intermediate level with no value of its own", () => {
    expect(findTopicPayload(data, "home")).toBeNull();
  });

  it("returns null for a topic that isn't in the tree", () => {
    expect(findTopicPayload(data, "home/nope")).toBeNull();
    expect(findTopicPayload(data, "nope/at/all")).toBeNull();
  });

  it("does not confuse a sibling that shares a prefix", () => {
    const d: MqttData = {
      a: node("a", {
        children: { b: node("a/b", { message: "yes" }) },
      }),
      ab: node("ab", { message: "no" }),
    };
    expect(findTopicPayload(d, "a/b")).toBe("yes");
  });
});

describe("findTopicIsRetained", () => {
  it("reports a retained leaf", () => {
    expect(findTopicIsRetained(data, "home/a")).toBe(true);
  });

  it("reports a non-retained leaf", () => {
    expect(findTopicIsRetained(data, "home/b")).toBe(false);
  });

  it("reports false for an unknown topic", () => {
    expect(findTopicIsRetained(data, "home/nope")).toBe(false);
  });
});

describe("formatPayloadForCopy", () => {
  it("pretty-prints JSON, matching what the panel shows", () => {
    expect(formatPayloadForCopy('{"v":1}')).toBe('{\n  "v": 1\n}');
  });

  it("leaves non-JSON untouched", () => {
    expect(formatPayloadForCopy("plain text")).toBe("plain text");
  });

  it("leaves an empty payload untouched", () => {
    expect(formatPayloadForCopy("")).toBe("");
  });

  it("does not mangle a bare number, which is technically valid JSON", () => {
    // JSON.parse("42") succeeds, and pretty-printing it is a no-op, so this
    // documents that the round trip is harmless rather than lossy.
    expect(formatPayloadForCopy("42")).toBe("42");
  });
});
