import { expect, test } from "vitest";
import { errorMessage } from "./error-message";

test("plain Error uses its message", () => {
  expect(errorMessage(new Error("boom"))).toBe("boom");
});

test("RuntimeError-shaped object uses its message", () => {
  expect(
    errorMessage({
      message: "file dialogs not available in server mode",
      cause: {},
      kind: "RuntimeError",
    })
  ).toBe("file dialogs not available in server mode");
});

test("Error carrying a serialised RuntimeError is unwrapped", () => {
  const wails = new Error(
    JSON.stringify({
      message: "publish middleware error: protobuf encode as demo.Alarm failed",
      cause: {},
      kind: "RuntimeError",
    })
  );
  expect(errorMessage(wails)).toBe(
    "publish middleware error: protobuf encode as demo.Alarm failed"
  );
});

test("JSON without a message field is left alone", () => {
  expect(errorMessage(new Error('{"kind":"RuntimeError"}'))).toBe(
    '{"kind":"RuntimeError"}'
  );
});

test("a message that merely looks like JSON is left alone", () => {
  expect(errorMessage(new Error("{not json}"))).toBe("{not json}");
});

test("strings and nullish values", () => {
  expect(errorMessage("just a string")).toBe("just a string");
  expect(errorMessage(undefined)).toBe("");
  expect(errorMessage(null)).toBe("");
});
