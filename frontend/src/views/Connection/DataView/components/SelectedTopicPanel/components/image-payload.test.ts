import { describe, expect, it } from "vitest";
import {
  base64ByteSize,
  detectImage,
  formatByteSize,
  imageDataUrl,
} from "./image-payload";

const b64 = (bytes: number[]): string =>
  btoa(String.fromCharCode(...bytes));

// 1x1 transparent PNG
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("detectImage", () => {
  it("detects PNG", () => {
    expect(detectImage(TINY_PNG)?.mime).toBe("image/png");
  });

  it("detects JPEG", () => {
    expect(detectImage(b64([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))?.mime).toBe(
      "image/jpeg"
    );
  });

  it("detects GIF", () => {
    expect(
      detectImage(b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]))?.mime
    ).toBe("image/gif");
  });

  it("detects WebP (RIFF container)", () => {
    const riff = [
      0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20,
    ];
    expect(detectImage(b64(riff))?.mime).toBe("image/webp");
  });

  it("does not flag RIFF that isn't WebP (e.g. WAV)", () => {
    const wav = [
      0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
      0x66, 0x6d, 0x74, 0x20,
    ];
    expect(detectImage(b64(wav))).toBeNull();
  });

  it("detects BMP", () => {
    const bmp = [0x42, 0x4d, 0x9a, 0, 0, 0, 0, 0, 0, 0, 0x7a, 0, 0, 0, 0, 0];
    expect(detectImage(b64(bmp))?.mime).toBe("image/bmp");
  });

  it("returns null for JSON text", () => {
    expect(detectImage(btoa('{"temperature": 21.5}'))).toBeNull();
  });

  it("returns null for plain text, empty and invalid base64", () => {
    expect(detectImage(btoa("hello world"))).toBeNull();
    expect(detectImage("")).toBeNull();
    expect(detectImage(null)).toBeNull();
    expect(detectImage("not-base64!!!")).toBeNull();
  });
});

describe("helpers", () => {
  it("builds a data url", () => {
    expect(imageDataUrl("AAAA", "image/png")).toBe(
      "data:image/png;base64,AAAA"
    );
  });

  it("computes decoded byte size", () => {
    expect(base64ByteSize(btoa("abc"))).toBe(3);
    expect(base64ByteSize(btoa("ab"))).toBe(2);
    expect(base64ByteSize(btoa(""))).toBe(0);
  });

  it("formats byte sizes", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(2048)).toBe("2.0 KB");
    expect(formatByteSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
