import { expect, test } from "vitest";
import { errorMessage } from "./strings";

test("errorMessage passes a string through untouched", () => {
  expect(errorMessage("no connection to broker")).toBe(
    "no connection to broker"
  );
});

test("errorMessage uses an Error's message", () => {
  expect(errorMessage(new Error("publish: timeout"))).toBe("publish: timeout");
});

test("errorMessage serialises a plain object rather than showing [object Object]", () => {
  expect(errorMessage({ code: 5, reason: "not authorised" })).toBe(
    '{"code":5,"reason":"not authorised"}'
  );
});

test("errorMessage survives a circular object", () => {
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  expect(typeof errorMessage(circular)).toBe("string");
});

test("errorMessage names the null and undefined cases", () => {
  expect(errorMessage(null)).toBe("Unknown error");
  expect(errorMessage(undefined)).toBe("Unknown error");
});

test("errorMessage stringifies other primitives", () => {
  expect(errorMessage(42)).toBe("42");
  expect(errorMessage(false)).toBe("false");
});
