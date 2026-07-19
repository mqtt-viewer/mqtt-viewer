import { expect, test } from "vitest";
import { getSortedDataKeys } from "../sort";
import type { MqttData } from "../../../stores/mqtt-data";

const UNSORTED_DATA = {
  "0000": {
    latestMessageTime: new Date(2021, 1, 1),
  },
  "5678": {
    latestMessageTime: new Date(2022, 1, 1),
  },
  "1211": {
    latestMessageTime: new Date(2018, 1, 1),
  },
  aaaaaa: {
    latestMessageTime: new Date(2032, 1, 1),
  },
  AAAbbbb: {
    latestMessageTime: new Date(2035, 1, 1),
  },
  zzzz: {
    latestMessageTime: new Date(2020, 1, 1),
  },
} as unknown as MqttData;

const SORTED_TIME_ASC = ["1211", "zzzz", "0000", "5678", "aaaaaa", "AAAbbbb"];

test("data keys are sorted according to ascending time", () => {
  const sortedKeys = getSortedDataKeys(UNSORTED_DATA, "time", "asc");
  expect(sortedKeys).toEqual(SORTED_TIME_ASC);
});

test("data keys are sorted according to descending time", () => {
  const sortedKeys = getSortedDataKeys(UNSORTED_DATA, "time", "desc");
  expect(sortedKeys).toEqual(SORTED_TIME_ASC.toReversed());
});

const SORTED_TOPIC_DESC = ["0000", "1211", "5678", "aaaaaa", "AAAbbbb", "zzzz"];

test("data keys are sorted by topic descending", () => {
  const sortedKeys = getSortedDataKeys(UNSORTED_DATA, "topic", "desc");
  expect(sortedKeys).toEqual(SORTED_TOPIC_DESC);
});

test("data keys are sorted by topic ascending", () => {
  const sortedKeys = getSortedDataKeys(UNSORTED_DATA, "topic", "asc");
  expect(sortedKeys).toEqual(SORTED_TOPIC_DESC.toReversed());
});

// ---- msgs sort ----

const COUNT_DATA = {
  quiet: { messageCount: 3 },
  loud: { messageCount: 100 },
  medium: { messageCount: 42 },
  silent: { messageCount: 0 },
} as unknown as MqttData;

test("msgs sort desc puts the most-messages topic first", () => {
  const sortedKeys = getSortedDataKeys(COUNT_DATA, "msgs", "desc");
  expect(sortedKeys).toEqual(["loud", "medium", "quiet", "silent"]);
});

test("msgs sort asc reverses to fewest-messages first", () => {
  const sortedKeys = getSortedDataKeys(COUNT_DATA, "msgs", "asc");
  expect(sortedKeys).toEqual(["silent", "quiet", "medium", "loud"]);
});

test("msgs sort breaks equal-count ties alphabetically (A -> Z under desc)", () => {
  const data = {
    charlie: { messageCount: 5 },
    alpha: { messageCount: 5 },
    bravo: { messageCount: 5 },
  } as unknown as MqttData;
  const sortedKeys = getSortedDataKeys(data, "msgs", "desc");
  expect(sortedKeys).toEqual(["alpha", "bravo", "charlie"]);
});

test("rate sort breaks equal-rate ties alphabetically (A -> Z under desc)", () => {
  const now = Date.now();
  const data = {
    charlie: { rate: { score: 9, lastMs: now } },
    alpha: { rate: { score: 9, lastMs: now } },
    bravo: { rate: { score: 9, lastMs: now } },
  } as unknown as MqttData;
  const sortedKeys = getSortedDataKeys(data, "rate", "desc");
  expect(sortedKeys).toEqual(["alpha", "bravo", "charlie"]);
});

// ---- rate sort ----

test("rate sort desc puts the busiest topic first", () => {
  const now = Date.now();
  const data = {
    quiet: { rate: { score: 1, lastMs: now } },
    busy: { rate: { score: 50, lastMs: now } },
    medium: { rate: { score: 10, lastMs: now } },
  } as unknown as MqttData;
  const sortedKeys = getSortedDataKeys(data, "rate", "desc");
  expect(sortedKeys).toEqual(["busy", "medium", "quiet"]);
});

test("rate sort treats a missing rate field as score 0 and sorts it last", () => {
  const now = Date.now();
  const data = {
    hasRate: { rate: { score: 5, lastMs: now } },
    noRate: {},
  } as unknown as MqttData;
  const sortedKeys = getSortedDataKeys(data, "rate", "desc");
  expect(sortedKeys).toEqual(["hasRate", "noRate"]);
});

test("rate sort ranks by decayed value: a fresher score outranks an older equal one", () => {
  const now = Date.now();
  const data = {
    stale: { rate: { score: 20, lastMs: now - 120_000 } }, // decayed hard
    fresh: { rate: { score: 20, lastMs: now } }, // barely decayed
  } as unknown as MqttData;
  const sortedKeys = getSortedDataKeys(data, "rate", "desc");
  expect(sortedKeys).toEqual(["fresh", "stale"]);
});

test("rate sort never mutates the score objects (live store is uncloned)", () => {
  const now = Date.now();
  const rateA = { score: 30, lastMs: now - 5_000 };
  const rateB = { score: 8, lastMs: now - 5_000 };
  const data = {
    a: { rate: rateA },
    b: { rate: rateB },
  } as unknown as MqttData;

  getSortedDataKeys(data, "rate", "desc");

  expect(rateA).toEqual({ score: 30, lastMs: now - 5_000 });
  expect(rateB).toEqual({ score: 8, lastMs: now - 5_000 });
});
