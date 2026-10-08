import { describe, expect, it } from "vitest";
import { ConnectionFormValidationSchema } from "./validation";

const hostSchema = ConnectionFormValidationSchema.innerType().shape.host;

describe("connection host validation", () => {
  it.each([
    "a",
    "0",
    "ab",
    "localhost",
    "127.0.0.1",
    "MQTT.Example.COM",
    "mqtt-broker.example.com",
    "a--b.example",
    "a".repeat(63),
    `${"a".repeat(63)}.${"b".repeat(63)}`,
    `a${"-".repeat(61)}b`,
  ])("accepts %s", (host) => {
    expect(hostSchema.safeParse(host).success).toBe(true);
  });

  it.each([
    "",
    "-",
    "-broker",
    "broker-",
    "-broker.example",
    "broker-.example",
    "broker.-example",
    "broker.example-",
    ".broker",
    "broker.",
    "broker..example",
    "broker_name",
    "broker name",
    " broker",
    "broker ",
    "mqtt://broker",
    "broker:1883",
    "::1",
    "[::1]",
    "mütt.example",
    "a".repeat(64),
    `${"a".repeat(64)}.example`,
    `broker.${"a".repeat(64)}`,
  ])("rejects %s", (host) => {
    expect(hostSchema.safeParse(host).success).toBe(false);
  });

  it("preserves hostname validation for numeric labels without enforcing IPv4 ranges", () => {
    expect(hostSchema.safeParse("999.999.999.999").success).toBe(true);
  });
});
