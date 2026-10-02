import { describe, expect, test } from "vitest";
import {
  topicMatchesQuery,
  topicMatchesSubscription,
  validateTopic,
  validateTopicFilter,
} from "./topic-filter";

describe("validateTopic", () => {
  test("plain topics are valid", () => {
    expect(validateTopic("house/kitchen/temp")).toBe(true);
  });

  test("single-level wildcard is valid anywhere", () => {
    expect(validateTopic("house/+/temp")).toBe(true);
    expect(validateTopic("+")).toBe(true);
  });

  test("multi-level wildcard is only valid as the final level", () => {
    expect(validateTopic("house/#")).toBe(true);
    expect(validateTopic("#")).toBe(true);
    expect(validateTopic("house/#/temp")).toBe(false);
  });

  test("wildcards embedded within a level are invalid", () => {
    expect(validateTopic("house/kit+chen")).toBe(false);
    expect(validateTopic("house/kitchen#")).toBe(false);
  });
});

describe("topicMatchesSubscription", () => {
  test("exact match", () => {
    expect(topicMatchesSubscription("a/b/c", "a/b/c")).toBe(true);
  });

  test("single-level wildcard matches exactly one level", () => {
    expect(topicMatchesSubscription("a/b/c", "a/+/c")).toBe(true);
    expect(topicMatchesSubscription("a/c", "a/+/c")).toBe(false);
  });

  test("multi-level wildcard matches remaining levels", () => {
    expect(topicMatchesSubscription("a/b/c/d", "a/#")).toBe(true);
    // Per MQTT, "a/#" also matches the parent "a" itself (# spans the parent
    // level and everything beneath it).
    expect(topicMatchesSubscription("a", "a/#")).toBe(true);
    expect(topicMatchesSubscription("b/c", "a/#")).toBe(false);
  });

  test("subscription shorter than topic without # does not match", () => {
    expect(topicMatchesSubscription("a/b/c", "a/b")).toBe(false);
  });
});

describe("topicMatchesQuery", () => {
  test("empty query matches everything", () => {
    expect(topicMatchesQuery("any/topic", "")).toBe(true);
  });

  test("case-insensitive substring on topic", () => {
    expect(topicMatchesQuery("House/Kitchen", "kitchen")).toBe(true);
    expect(topicMatchesQuery("house/kitchen", "GARAGE")).toBe(false);
  });

  test("matches on an extra haystack (payload)", () => {
    expect(topicMatchesQuery("house/kitchen", "22.5", ["temp=22.5C"])).toBe(
      true
    );
    expect(topicMatchesQuery("house/kitchen", "99", ["temp=22.5C"])).toBe(
      false
    );
  });

  test("wildcard query matches via MQTT subscription semantics", () => {
    expect(topicMatchesQuery("house/kitchen/temp", "house/+/temp")).toBe(true);
    expect(topicMatchesQuery("house/hall/humidity", "house/#")).toBe(true);
  });

  test("invalid wildcard query falls back to substring only", () => {
    // "house/#/temp" is not a valid filter (# not final), so only substring
    // matching applies — and the literal string isn't a substring of the topic.
    expect(topicMatchesQuery("house/kitchen/temp", "house/#/temp")).toBe(false);
  });

  // A5: an intermediate node's own path does NOT wildcard-match a deeper
  // pattern; the List view keeps it only because a descendant leaf matches
  // (that keep-set behaviour is filter.ts's job, exercised in filter.test.ts).
  test("intermediate node does not wildcard-match a leaf-level pattern", () => {
    expect(topicMatchesQuery("house", "house/+")).toBe(false);
    expect(topicMatchesQuery("house/kitchen", "house/+")).toBe(true);
  });
});

describe("validateTopicFilter", () => {
  test("valid filters pass", () => {
    expect(validateTopicFilter("sensors/+/telemetry")).toBeNull();
    expect(validateTopicFilter("sensors/#")).toBeNull();
    expect(validateTopicFilter("#")).toBeNull();
    expect(validateTopicFilter("+")).toBeNull();
    expect(validateTopicFilter("a/b/c")).toBeNull();
    expect(validateTopicFilter("$SYS/#")).toBeNull();
  });

  test("empty filter", () => {
    expect(validateTopicFilter("")).toBe("Enter a topic filter");
  });

  test("leading or trailing whitespace", () => {
    expect(validateTopicFilter("   ")).toBe("No leading or trailing spaces");
    expect(validateTopicFilter(" sensors/#")).toBe(
      "No leading or trailing spaces"
    );
    expect(validateTopicFilter("sensors/# ")).toBe(
      "No leading or trailing spaces"
    );
    expect(validateTopicFilter("sensors/temp ")).toBe(
      "No leading or trailing spaces"
    );
  });

  test("NUL byte is rejected, and takes precedence over whitespace", () => {
    expect(validateTopicFilter("sensors/\0/telemetry")).toBe(
      "No NUL bytes allowed"
    );
    expect(validateTopicFilter(" sensors/\0 ")).toBe("No NUL bytes allowed");
  });

  test("shared subscription filters are rejected", () => {
    expect(validateTopicFilter("$share/group/sensors/#")).toBe(
      "Shared subscription filters can't be bindings"
    );
  });

  test("'#' must be the last segment", () => {
    expect(validateTopicFilter("sensors/#/telemetry")).toBe(
      "'#' must be the last segment"
    );
    expect(validateTopicFilter("sensors/foo#bar")).toBe(
      "'#' must be the last segment"
    );
  });

  test("'+' must be a whole segment", () => {
    expect(validateTopicFilter("sensors/foo+bar/telemetry")).toBe(
      "'+' must be a whole segment"
    );
    expect(validateTopicFilter("+sensors/telemetry")).toBe(
      "'+' must be a whole segment"
    );
  });
});
