import { describe, expect, it } from "vitest";
import {
  PAYLOAD_PREVIEW_CAP,
  binaryPayloadSummary,
  buildPayloadPreview,
  computePopoverPosition,
  isBinaryPayload,
  previewPayload,
} from "./hover-preview";

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

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

  it("substitutes invisible control characters with visible glyphs", () => {
    expect(previewPayload("a\u0000b\u0007c\u007fd")).toBe("a␀b␇c␡d");
  });

  it("keeps tabs and newlines intact", () => {
    expect(previewPayload("a\tb\nc\r\nd")).toBe("a\tb\nc\r\nd");
  });
});

describe("isBinaryPayload", () => {
  it("treats plain JSON as text", () => {
    expect(isBinaryPayload('{"temperature": 21.5}')).toBe(false);
  });

  it("treats an empty payload as text", () => {
    expect(isBinaryPayload("")).toBe(false);
  });

  it("tolerates the odd control character in a long text payload", () => {
    expect(isBinaryPayload("a".repeat(100) + "\u0000")).toBe(false);
  });

  it("flags a payload dominated by control characters", () => {
    expect(isBinaryPayload("\u0000\u0001\u0002\u0003abc")).toBe(true);
  });

  it("flags utf8 replacement characters from decoding raw bytes", () => {
    expect(isBinaryPayload("����ab")).toBe(true);
  });
});

describe("binaryPayloadSummary", () => {
  it("labels a detected image with its format and size", () => {
    // 8-byte PNG signature.
    const png = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(binaryPayloadSummary(png)).toBe("PNG image (8 B)");
  });

  it("labels other binary content with its size", () => {
    expect(binaryPayloadSummary(b64([0x00, 0x01, 0x02, 0x03]))).toBe(
      "Binary payload (4 B)"
    );
  });
});

describe("buildPayloadPreview", () => {
  it("returns a text preview for textual payloads", () => {
    expect(buildPayloadPreview('{"a": 1}', b64([0x7b]))).toEqual({
      kind: "text",
      text: '{"a": 1}',
    });
  });

  it("returns a binary summary for binary payloads", () => {
    const bytes = [0x00, 0x01, 0x02, 0x03];
    const preview = buildPayloadPreview(
      String.fromCharCode(...bytes),
      b64(bytes)
    );
    expect(preview).toEqual({
      kind: "binary",
      summary: "Binary payload (4 B)",
    });
  });
});

describe("computePopoverPosition", () => {
  const base = {
    popoverWidth: 300,
    popoverHeight: 100,
    viewportWidth: 1000,
    viewportHeight: 800,
  };

  it("centres on the cursor and sits above it", () => {
    const { left, top } = computePopoverPosition({
      ...base,
      mouseX: 500,
      mouseY: 500,
    });
    expect(left).toBe(350);
    expect(top).toBe(392);
  });

  it("clamps to the left viewport edge", () => {
    const { left } = computePopoverPosition({ ...base, mouseX: 10, mouseY: 500 });
    expect(left).toBe(8);
  });

  it("clamps to the right viewport edge", () => {
    const { left } = computePopoverPosition({
      ...base,
      mouseX: 990,
      mouseY: 500,
    });
    expect(left).toBe(1000 - 300 - 8);
  });

  it("flips below the cursor when there is no room above", () => {
    const { top } = computePopoverPosition({ ...base, mouseX: 500, mouseY: 50 });
    expect(top).toBe(58);
  });

  it("clamps to the bottom viewport edge when flipped below", () => {
    const { top } = computePopoverPosition({
      ...base,
      viewportHeight: 150,
      mouseX: 500,
      mouseY: 60,
    });
    expect(top).toBe(150 - 100 - 8);
  });

  it("honours a custom margin", () => {
    const { left } = computePopoverPosition({
      ...base,
      mouseX: 0,
      mouseY: 500,
      margin: 20,
    });
    expect(left).toBe(20);
  });
});
