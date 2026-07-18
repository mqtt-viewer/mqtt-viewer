import { describe, expect, it } from "vitest";
import { PAYLOAD_PREVIEW_CAP, previewPayload } from "./hover-preview";

describe("previewPayload", () => {
  it("returns a short payload unchanged", () => {
    expect(previewPayload('{"temperature": 21.5}')).toBe(
      '{"temperature": 21.5}'
    );
  });

  it("truncates a long payload and appends a marker", () => {
    const long = "a".repeat(PAYLOAD_PREVIEW_CAP + 100);
    const preview = previewPayload(long);
    expect(preview.length).toBe(PAYLOAD_PREVIEW_CAP + 1);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.startsWith("a".repeat(PAYLOAD_PREVIEW_CAP))).toBe(true);
  });

  it("leaves a payload exactly at the cap unchanged", () => {
    const exact = "b".repeat(PAYLOAD_PREVIEW_CAP);
    expect(previewPayload(exact)).toBe(exact);
  });

  it("returns an empty string for an empty payload", () => {
    expect(previewPayload("")).toBe("");
  });

  it("honours a custom cap", () => {
    expect(previewPayload("abcdef", 3)).toBe("abc…");
  });
});
