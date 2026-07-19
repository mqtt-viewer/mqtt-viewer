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

test("empty or whitespace-only filter", () => {
  expect(validateTopicFilter("")).toBe("Enter a topic filter");
  expect(validateTopicFilter("   ")).toBe("Enter a topic filter");
  expect(validateTopicFilter(" sensors/#")).toBe("Enter a topic filter");
  expect(validateTopicFilter("sensors/# ")).toBe("Enter a topic filter");
});

test("NUL byte is rejected", () => {
  expect(validateTopicFilter("sensors/\0/telemetry")).toBe(
    "Enter a topic filter"
  );
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
