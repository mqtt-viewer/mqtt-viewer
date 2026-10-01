import { describe, it, expect } from "vitest";
import {
  findTopicIsRetained,
  findTopicNode,
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

// Topic levels are publisher-controlled, so a level named after an
// Object.prototype member must be looked up like any other.
describe("lookups of levels named after Object.prototype members", () => {
  const PROTO_LEVELS = [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
  ];

  it("returns null rather than an inherited member when no such topic exists", () => {
    for (const level of PROTO_LEVELS) {
      for (const topic of [level, `${level}/x`, `home/${level}`, `home/${level}/x`]) {
        expect(findTopicNode(data, topic), topic).toBeNull();
        expect(findTopicPayload(data, topic), topic).toBeNull();
        expect(findTopicIsRetained(data, topic), topic).toBe(false);
      }
    }
  });

  it("finds a real topic with such a level", () => {
    const children: MqttData = {};
    for (const level of PROTO_LEVELS) {
      // A computed key defines an own property, even for __proto__.
      Object.defineProperty(children, level, {
        value: node(`home/${level}`, { message: `p:${level}`, isRetained: true }),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    const d: MqttData = {
      ["__proto__"]: node("__proto__", {
        subtopicCount: 1,
        children: { ["constructor"]: node("__proto__/constructor", { message: "deep" }) },
      }),
      home: node("home", { subtopicCount: PROTO_LEVELS.length, children }),
    };
    expect(findTopicNode(d, "__proto__")?.topic).toBe("__proto__");
    expect(findTopicPayload(d, "__proto__/constructor")).toBe("deep");
    for (const level of PROTO_LEVELS) {
      expect(findTopicPayload(d, `home/${level}`)).toBe(`p:${level}`);
      expect(findTopicIsRetained(d, `home/${level}`)).toBe(true);
      expect(findTopicNode(d, `home/${level}/x`)).toBeNull();
    }
    expect(findTopicNode(d, "toString")).toBeNull();
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
