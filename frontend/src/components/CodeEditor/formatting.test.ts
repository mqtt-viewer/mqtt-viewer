import { expect, test } from "vitest";
import { formatPayload } from "./formatting";

test("hex formats a binary string into space-separated hex bytes", () => {
  const payload = String.fromCharCode(0x00, 0x01, 0x7f, 0x80, 0xff);

  const result = formatPayload(payload, "hex");
  expect(result).toBe("00 01 7f 80 ff");
});

test("hex uses utf-8 bytes when the string contains chars above 0xff", () => {
  const payload = "€";

  const result = formatPayload(payload, "hex");
  expect(result).toBe("e2 82 ac");
});

test("hex wraps output at 16 bytes per line", () => {
  const payload = String.fromCharCode(...Array.from({ length: 20 }, (_, i) => i));

  const result = formatPayload(payload, "hex");
  expect(result).toBe(
    "00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f\n10 11 12 13"
  );
});

test("none and json formats return the payload unchanged", () => {
  const payload = '{"a":1}';

  expect(formatPayload(payload, "none")).toBe(payload);
  expect(formatPayload(payload, "json")).toBe(payload);
});
