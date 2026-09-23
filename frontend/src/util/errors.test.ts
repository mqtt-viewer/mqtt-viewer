import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("unwraps the JSON body Wails rejects with", () => {
    const e = new Error(
      JSON.stringify({ message: "collection 7 not found", kind: "RuntimeError" })
    );
    expect(errorMessage(e)).toBe("collection 7 not found");
  });

  it("uses an Error's message when it is not JSON", () => {
    expect(errorMessage(new Error("network down"))).toBe("network down");
  });

  it("keeps the message when the JSON has no string message field", () => {
    const withoutMessage = JSON.stringify({ kind: "RuntimeError" });
    expect(errorMessage(new Error(withoutMessage))).toBe(withoutMessage);
    const numeric = JSON.stringify({ message: 7 });
    expect(errorMessage(new Error(numeric))).toBe(numeric);
    expect(errorMessage(new Error("42"))).toBe("42");
  });

  it("stringifies anything that is not an Error", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage({ message: "not an error" })).toBe("[object Object]");
  });
});
