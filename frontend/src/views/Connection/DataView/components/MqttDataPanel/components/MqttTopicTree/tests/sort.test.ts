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

const SORTED_ALPH_ASC = ["0000", "1211", "5678", "aaaaaa", "AAAbbbb", "zzzz"];

test("data keys are sorted alphabetically ascending", () => {
  const sortedKeys = getSortedDataKeys(UNSORTED_DATA, "alphabetical", "asc");
  expect(sortedKeys).toEqual(SORTED_ALPH_ASC);
});

test("data keys are sorted alphabetically descending", () => {
  const sortedKeys = getSortedDataKeys(UNSORTED_DATA, "alphabetical", "desc");
  expect(sortedKeys).toEqual(SORTED_ALPH_ASC.toReversed());
});
