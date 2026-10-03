import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import type * as mqtt from "bindings/mqtt-viewer/backend/mqtt/models";
import type * as events from "bindings/mqtt-viewer/events/models";
import { createMqttDataStore } from "./mqtt-data";
import { createHighlightedMqttTopicsStore } from "./highlighted-topics";

const listeners = new Map<string, (e: any) => void>();

vi.mock("@wailsio/runtime", () => ({
  Events: {
    On: vi.fn((eventName: string, handler: (e: any) => void) => {
      listeners.set(eventName, handler);
      return () => listeners.delete(eventName);
    }),
  },
}));

const connectionEventSet = {
  mqttConnected: "mqttConnected",
  mqttDisconnected: "mqttDisconnected",
  mqttConnecting: "mqttConnecting",
  mqttReconnecting: "mqttReconnecting",
  mqttClientError: "mqttClientError",
  mqttMessages: "mqttMessages",
  mqttLatency: "mqttLatency",
  mqttClearHistory: "mqttClearHistory",
} as unknown as events.ConnectionEventsSet;

const makeMessage = (
  id: string,
  topic: string,
  payload: string,
  timeMs: number
): mqtt.MqttMessage =>
  ({
    id,
    topic,
    payload: btoa(payload),
    timeMs,
    retain: false,
    middlewareProperties: undefined,
  }) as any;

const fireMessages = (messages: mqtt.MqttMessage[]) => {
  const handler = listeners.get(connectionEventSet.mqttMessages);
  if (!handler) throw new Error("no mqttMessages listener registered");
  handler({ data: messages });
};

const fireClearHistory = () => {
  const handler = listeners.get(connectionEventSet.mqttClearHistory);
  if (!handler) throw new Error("no mqttClearHistory listener registered");
  handler({});
};

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
});

describe("processMessages batching", () => {
  it("keeps the latest payload per topic and sums counts across levels", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    // 3 topics under a shared parent, 3 messages each, interleaved order.
    const messages: mqtt.MqttMessage[] = [];
    for (let round = 0; round < 3; round++) {
      messages.push(
        makeMessage(`a-${round}`, "home/sensors/a", `a-payload-${round}`, round * 10 + 1)
      );
      messages.push(
        makeMessage(`b-${round}`, "home/sensors/b", `b-payload-${round}`, round * 10 + 2)
      );
      messages.push(
        makeMessage(`c-${round}`, "home/sensors/c", `c-payload-${round}`, round * 10 + 3)
      );
    }

    fireMessages(messages);

    const data = get(store);
    const sensors = data.home.children.sensors;

    expect(sensors.children.a.message).toBe("a-payload-2");
    expect(sensors.children.b.message).toBe("b-payload-2");
    expect(sensors.children.c.message).toBe("c-payload-2");

    expect(sensors.children.a.messageCount).toBe(3);
    expect(sensors.children.b.messageCount).toBe(3);
    expect(sensors.children.c.messageCount).toBe(3);

    // Parent levels sum counts across all 9 messages.
    expect(sensors.messageCount).toBe(9);
    expect(data.home.messageCount).toBe(9);

    // subtopicCount reflects unique direct children at each level.
    expect(data.home.subtopicCount).toBe(1);
    expect(sensors.subtopicCount).toBe(3);
    expect(sensors.children.a.subtopicCount).toBe(0);

    unsub();
  });

  it("notifies subscribers at most once per batch, not once per message", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);

    let dataNotifications = 0;
    const unsubData = store.subscribe(() => {
      dataNotifications += 1;
    });

    let highlightNotifications = 0;
    const unsubHighlight = highlightStore.subscribe(() => {
      highlightNotifications += 1;
    });

    const messages: mqtt.MqttMessage[] = [];
    for (let i = 0; i < 100; i++) {
      const topicIndex = i % 10;
      messages.push(
        makeMessage(`m-${i}`, `topic/${topicIndex}`, `payload-${i}`, i)
      );
    }

    fireMessages(messages);

    // 1 initial notification on subscribe + 1 for the whole batch.
    expect(dataNotifications).toBe(2);
    expect(highlightNotifications).toBe(2);

    unsubData();
    unsubHighlight();
  });

  it("records message-update on the leaf and child-update on ancestors, using the last message id per topic", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    fireMessages([
      makeMessage("1", "home/sensors/a", "first", 1),
      makeMessage("2", "home/sensors/a", "second", 2),
    ]);

    const highlights = get(highlightStore);

    expect(highlights.get("home")?.highlightCause).toBe("child-update");
    expect(highlights.get("home/sensors")?.highlightCause).toBe(
      "child-update"
    );
    expect(highlights.get("home/sensors/a")?.highlightCause).toBe(
      "message-update"
    );

    // Every mark uses the last message's id for that topic in the batch.
    expect(highlights.get("home")?.highlightFromMessageId).toBe("2");
    expect(highlights.get("home/sensors")?.highlightFromMessageId).toBe("2");
    expect(highlights.get("home/sensors/a")?.highlightFromMessageId).toBe(
      "2"
    );

    unsub();
  });

  it("accumulates messageCount across sequential batches", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    fireMessages([makeMessage("1", "a/b", "first", 1)]);
    fireMessages([
      makeMessage("2", "a/b", "second", 2),
      makeMessage("3", "a/b", "third", 3),
    ]);

    const data = get(store);
    expect(data.a.children.b.messageCount).toBe(3);
    expect(data.a.children.b.message).toBe("third");
    expect(data.a.messageCount).toBe(3);

    unsub();
  });

  it("empties the tree on a clear-history event", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    fireMessages([makeMessage("1", "a/b", "payload", 1)]);
    expect(Object.keys(get(store))).toHaveLength(1);

    fireClearHistory();

    expect(get(store)).toEqual({});

    unsub();
  });
});

const makeRetainedMessage = (
  id: string,
  topic: string,
  payload: string,
  timeMs: number
): mqtt.MqttMessage =>
  ({
    ...makeMessage(id, topic, payload, timeMs),
    retain: true,
  }) as any;

describe("retained tracking", () => {
  it("marks a topic retained from a retained message with a payload", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});
    fireMessages([makeRetainedMessage("1", "home/a", "value", 1)]);
    expect(get(store).home.children.a.isRetained).toBe(true);
    unsub();
  });

  it("unmarks a topic on a zero-length retained message", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});
    fireMessages([makeRetainedMessage("1", "home/a", "value", 1)]);
    fireMessages([makeRetainedMessage("2", "home/a", "", 2)]);
    expect(get(store).home.children.a.isRetained).toBe(false);
    unsub();
  });

  it("leaves retained state alone for non-retained messages", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});
    fireMessages([makeRetainedMessage("1", "home/a", "value", 1)]);
    // ordinary traffic says nothing about the retained value, so it must not
    // clear the mark
    fireMessages([makeMessage("2", "home/a", "live", 2)]);
    expect(get(store).home.children.a.isRetained).toBe(true);
    unsub();
  });

  it("never marks intermediate levels retained", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});
    fireMessages([makeRetainedMessage("1", "home/a/b", "value", 1)]);
    expect(get(store).home.isRetained).toBe(false);
    expect(get(store).home.children.a.isRetained).toBe(false);
    expect(get(store).home.children.a.children.b.isRetained).toBe(true);
    unsub();
  });

  it("applies a tombstone that arrives mid-batch, not just the last message", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});
    fireMessages([makeRetainedMessage("1", "home/a", "value", 1)]);
    // A batch is collapsed to its last message per topic. If retained state
    // came from that last message alone, the tombstone here would be lost and
    // the topic would stay marked retained.
    fireMessages([
      makeRetainedMessage("2", "home/a", "", 2),
      makeMessage("3", "home/a", "live", 3),
    ]);
    expect(get(store).home.children.a.isRetained).toBe(false);
    unsub();
  });
});

describe("markRetainedCleared", () => {
  it("clears the flag for a known topic", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});
    fireMessages([makeRetainedMessage("1", "home/a", "value", 1)]);
    expect(get(store).home.children.a.isRetained).toBe(true);

    store.markRetainedCleared(["home/a"]);

    expect(get(store).home.children.a.isRetained).toBe(false);
    unsub();
  });

  it("leaves a sibling and an ancestor's flag alone", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});
    fireMessages([
      makeRetainedMessage("1", "home/a/b", "value", 1),
      makeRetainedMessage("2", "home/a/c", "value", 2),
    ]);
    // an intermediate level is never itself retained, but set it explicitly
    // via a retained message on the shorter path too, to prove clearing a
    // deeper topic doesn't touch it
    fireMessages([makeRetainedMessage("3", "home", "value", 3)]);

    store.markRetainedCleared(["home/a/b"]);

    expect(get(store).home.children.a.children.b.isRetained).toBe(false);
    expect(get(store).home.children.a.children.c.isRetained).toBe(true);
    expect(get(store).home.isRetained).toBe(true);
    unsub();
  });

  it("is a no-op for a topic it does not know about", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});
    fireMessages([makeRetainedMessage("1", "home/a", "value", 1)]);

    expect(() =>
      store.markRetainedCleared(["home/does-not-exist"])
    ).not.toThrow();
    expect(get(store).home.children.a.isRetained).toBe(true);
    unsub();
  });
});

describe("rate score bumps", () => {
  it("initialises and bumps rate on the leaf and every ancestor by the batch count", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const t = 1000;
    fireMessages([
      makeMessage("1", "home/sensors/a", "x", t),
      makeMessage("2", "home/sensors/a", "y", t),
      makeMessage("3", "home/sensors/a", "z", t),
    ]);

    const data = get(store);
    const leaf = data.home.children.sensors.children.a;

    // A fresh node's score equals the batch count (decay is a no-op on the
    // very first bump), and lastMs is the batch timestamp.
    expect(leaf.rate?.score).toBe(3);
    expect(leaf.rate?.lastMs).toBe(t);
    // Every ancestor carries the same subtree-aggregate score.
    expect(data.home.children.sensors.rate?.score).toBe(3);
    expect(data.home.rate?.score).toBe(3);

    unsub();
  });

  it("aggregates sibling counts into shared ancestors within one batch", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const t = 2000;
    fireMessages([
      makeMessage("1", "home/sensors/a", "x", t),
      makeMessage("2", "home/sensors/a", "y", t),
      makeMessage("3", "home/sensors/a", "z", t), // a: 3
      makeMessage("4", "home/sensors/b", "p", t),
      makeMessage("5", "home/sensors/b", "q", t), // b: 2
    ]);

    const data = get(store);
    const sensors = data.home.children.sensors;

    expect(sensors.children.a.rate?.score).toBe(3);
    expect(sensors.children.b.rate?.score).toBe(2);
    // Ancestor rate is the subtree aggregate: 3 + 2.
    expect(sensors.rate?.score).toBe(5);
    expect(data.home.rate?.score).toBe(5);

    unsub();
  });

  it("decays a topic's rate score across batches at later timestamps", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    // First batch seeds score 1. (Uses a realistic non-zero timestamp: the
    // shared decay engine treats lastMs === 0 as "uninitialised", so an epoch-0
    // timestamp would skip the first decay — a non-issue for real MQTT stamps.)
    fireMessages([makeMessage("1", "a/b", "first", 1_000)]);
    // Second batch 14000ms later (one tau) decays the old score by e^-1
    // (~0.368) then adds 1.
    fireMessages([makeMessage("2", "a/b", "second", 15_000)]);

    const data = get(store);
    const score = data.a.children.b.rate?.score ?? 0;
    expect(score).toBeCloseTo(Math.exp(-1) + 1, 5);

    unsub();
  });
});

// Topic levels come from whoever publishes on the broker, so a level that
// shares its name with an Object.prototype member must be an ordinary topic.
describe("topic levels named after Object.prototype members", () => {
  const PROTO_LEVELS = [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "__defineGetter__",
  ];

  const nodeAt = (data: any, topic: string) => {
    let children = data;
    let node: any;
    for (const level of topic.split("/")) {
      if (!Object.prototype.hasOwnProperty.call(children, level)) return undefined;
      node = children[level];
      children = node.children;
    }
    return node;
  };

  it("stores them as ordinary topics without touching Object or its prototype", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    const topics: string[] = [];
    for (const level of PROTO_LEVELS) {
      topics.push(level, `${level}/x`, `a/${level}`, `a/${level}/y`);
    }
    // A topic after all the hostile ones, to prove the batch is not cut short.
    topics.push("after/last");
    const messages = topics.map((t, i) => makeMessage(`m${i}`, t, `p:${t}`, i + 1));

    expect(() => fireMessages(messages)).not.toThrow();

    const data = get(store);
    for (const t of topics) {
      const node = nodeAt(data, t);
      expect(node, t).toBeDefined();
      expect(node.topic).toBe(t);
      expect(node.message).toBe(`p:${t}`);
    }
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining([...PROTO_LEVELS, "a", "after"])
    );
    expect(nodeAt(data, "a").subtopicCount).toBe(PROTO_LEVELS.length);
    expect(store.getAllTopics()).toEqual(expect.arrayContaining(topics));

    // Nothing leaked onto the globals.
    const leaked = ["messageCount", "message", "children", "topic", "rate", "isRetained"];
    for (const key of leaked) {
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, key), key).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(Object, key), key).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(Object.prototype.toString, key),
        key
      ).toBe(false);
    }
    expect(({} as any).messageCount).toBeUndefined();

    // A second batch on the same topics updates them in place.
    fireMessages(topics.map((t, i) => makeMessage(`n${i}`, t, `q:${t}`, 1000 + i)));
    const again = get(store);
    for (const t of topics) {
      expect(nodeAt(again, t).message).toBe(`q:${t}`);
    }

    unsub();
  });

  it("clears the retained marker on such a topic and ignores missing ones", () => {
    const highlightStore = createHighlightedMqttTopicsStore();
    const store = createMqttDataStore(highlightStore, connectionEventSet);
    const unsub = store.subscribe(() => {});

    fireMessages([
      { ...makeMessage("1", "constructor/x", "v", 1), retain: true } as any,
    ]);
    expect(nodeAt(get(store), "constructor/x").isRetained).toBe(true);
    expect(() =>
      store.markRetainedCleared(["constructor/x", "toString", "valueOf/y", "__proto__"])
    ).not.toThrow();
    expect(nodeAt(get(store), "constructor/x").isRetained).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "isRetained")).toBe(false);

    unsub();
  });
});

describe("decode state", () => {
  const withProps = (
    message: mqtt.MqttMessage,
    props: Record<string, unknown>
  ): mqtt.MqttMessage => ({ ...message, middlewareProperties: props }) as any;

  it("marks a decoded leaf, names its type, and never marks ancestors failed", () => {
    const store = createMqttDataStore(
      createHighlightedMqttTopicsStore(),
      connectionEventSet
    );
    const unsub = store.subscribe(() => {});

    fireMessages([
      withProps(makeMessage("1", "plant/a/ok", "{}", 1), {
        IsDecodedProto: true,
        ProtoDescriptorName: "demo.Telemetry",
      }),
    ]);
    let data = get(store);
    const ok = data.plant.children.a.children.ok;
    expect(ok.isDecodedProto).toBe(true);
    expect(ok.protoDescriptorName).toBe("demo.Telemetry");
    expect(ok.isProtoDecodeFailed).toBe(false);

    fireMessages([
      withProps(makeMessage("2", "plant/a/bad", "raw", 2), {
        ProtoDecodeFailed: true,
        ProtoDescriptorName: "demo.Alarm",
      }),
    ]);
    data = get(store);
    const bad = data.plant.children.a.children.bad;
    expect(bad.isProtoDecodeFailed).toBe(true);
    expect(bad.isDecodedProto).toBe(false);
    expect(bad.protoDescriptorName).toBe("demo.Alarm");
    expect(data.plant.isProtoDecodeFailed).toBeFalsy();
    expect(data.plant.children.a.isProtoDecodeFailed).toBeFalsy();

    // A later good decode on the same topic clears the failure.
    fireMessages([
      withProps(makeMessage("3", "plant/a/bad", "{}", 3), {
        IsDecodedProto: true,
        ProtoDescriptorName: "demo.Alarm",
      }),
    ]);
    expect(get(store).plant.children.a.children.bad.isProtoDecodeFailed).toBe(
      false
    );
    unsub();
  });
});
