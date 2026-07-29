import { expect, test } from "vitest";
import { validateTopicFilter } from "./topic-filter";

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
