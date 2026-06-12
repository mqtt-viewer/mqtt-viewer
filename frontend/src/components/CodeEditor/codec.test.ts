import { expect, test } from "vitest";
import { base64ToUtf8, decodePayload, encodePayload } from "./codec";

test("base64ToUtf8 decodes multibyte utf-8 payloads", () => {
  const text = "héllo 中文 🚀";
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  expect(base64ToUtf8(b64)).toBe(text);
});

test("base64ToUtf8 decodes plain ascii payloads", () => {
  expect(base64ToUtf8(btoa("hello world"))).toBe("hello world");
});

test("base64ToUtf8 falls back to latin-1 for invalid utf-8 bytes", () => {
  const b64 = btoa(String.fromCharCode(0xff, 0xfe));
  expect(base64ToUtf8(b64)).toBe("ÿþ");
});

test("base64 codec round-trips non-latin-1 text", () => {
  const text = "héllo 中文 🚀";
  const encoded = encodePayload(text, "base64");
  expect(decodePayload(encoded, "base64")).toBe(text);
});

test("hex codec round-trips non-latin-1 text", () => {
  const text = "héllo 中文 🚀";
  const encoded = encodePayload(text, "hex");
  expect(decodePayload(encoded, "hex")).toBe(text);
});
