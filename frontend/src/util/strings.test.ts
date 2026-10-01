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

test("errorMessage unwraps the envelope inside an Error too", () => {
  expect(
    errorMessage(new Error('{"message":"connect: refused","cause":{},"kind":"RuntimeError"}'))
  ).toBe("connect: refused");
});

test("errorMessage unwraps the Wails runtime error envelope", () => {
  expect(
    errorMessage('{"message":"specified connection not connected","cause":{},"kind":"RuntimeError"}')
  ).toBe("specified connection not connected");
  expect(errorMessage("{not json")).toBe("{not json");
  expect(errorMessage('{"kind":"RuntimeError"}')).toBe('{"kind":"RuntimeError"}');
});

test("errorMessage keeps an envelope without a string message as it is", () => {
  const numeric = JSON.stringify({ message: 7 });
  expect(errorMessage(new Error(numeric))).toBe(numeric);
  expect(errorMessage(new Error("42"))).toBe("42");
});

test("errorMessage uses the message of an error-shaped object", () => {
  expect(errorMessage({ message: "not an Error instance" })).toBe("not an Error instance");
  // Non-enumerable, as on an Error from another realm: JSON would say "{}".
  const crossRealm = Object.defineProperty({}, "message", { value: "boom", enumerable: false });
  expect(errorMessage(crossRealm)).toBe("boom");
});

test("errorMessage falls back to a sentence rather than [object Object]", () => {
  class Opaque {
    #reason = "hidden";
  }
  expect(errorMessage(new Opaque())).toBe("Unknown error");
  expect(errorMessage({})).toBe("Unknown error");
  expect(errorMessage(Object.create(null))).toBe("Unknown error");
  // A custom toString still says something.
  expect(errorMessage({ toString: () => "custom failure" })).toBe("custom failure");
});
