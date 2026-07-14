import { describe, it, expect } from "vitest";
import {
  numericFields,
  valueAtPath,
  payloadTree,
  hasNumericFields,
} from "./payload-fields";

describe("numericFields", () => {
  it("extracts top-level numeric fields", () => {
    expect(numericFields('{"temp":24.6,"humidity":61}')).toEqual([
      { path: "temp", value: 24.6 },
      { path: "humidity", value: 61 },
    ]);
  });

  it("extracts nested fields with dotted paths", () => {
    const fields = numericFields('{"sensor":{"rssi":-72,"battery":3.7}}');
    expect(fields).toEqual([
      { path: "sensor.rssi", value: -72 },
      { path: "sensor.battery", value: 3.7 },
    ]);
  });

  it("indexes array elements", () => {
    expect(numericFields('{"vals":[1,2,3]}')).toEqual([
      { path: "vals.0", value: 1 },
      { path: "vals.1", value: 2 },
      { path: "vals.2", value: 3 },
    ]);
  });

  it("charts a bare numeric payload with empty path", () => {
    expect(numericFields("42.5")).toEqual([{ path: "", value: 42.5 }]);
  });

  it("excludes non-numeric strings, booleans, and null", () => {
    expect(numericFields('{"a":1,"b":"x","c":true,"d":null}')).toEqual([
      { path: "a", value: 1 },
    ]);
  });

  it("casts quoted numerics to numbers", () => {
    expect(numericFields('{"temp":"24.6","rssi":"-72","load":"1e3"}')).toEqual([
      { path: "temp", value: 24.6 },
      { path: "rssi", value: -72 },
      { path: "load", value: 1000 },
    ]);
  });

  it("charts a bare quoted numeric payload with empty path", () => {
    expect(numericFields('"42.5"')).toEqual([{ path: "", value: 42.5 }]);
  });

  it("excludes strings that are not purely numeric", () => {
    expect(
      numericFields('{"a":"24C","b":"","c":"0x1f","d":"1,2,3","e":"NaN"}')
    ).toEqual([]);
  });

  it("casts EU-style decimal commas to numbers", () => {
    // Run lengths that are not a multiple of 3 read as a decimal separator.
    expect(
      numericFields('{"temp":"12,1","rssi":"-3,05","pi":"3,1416"}')
    ).toEqual([
      { path: "temp", value: 12.1 },
      { path: "rssi", value: -3.05 },
      { path: "pi", value: 3.1416 },
    ]);
  });

  it("reads 3/6/9-digit comma runs as thousands grouping", () => {
    expect(
      numericFields(
        '{"a":"1,000","b":"12,345","c":"1,000000","d":"12,345,678"}'
      )
    ).toEqual([
      { path: "a", value: 1000 },
      { path: "b", value: 12345 },
      { path: "c", value: 1000000 },
      { path: "d", value: 12345678 },
    ]);
  });

  it("excludes malformed comma numbers", () => {
    expect(numericFields('{"a":"1,2,3","b":"1,00,000"}')).toEqual([]);
  });

  it("returns [] for non-JSON payloads", () => {
    expect(numericFields("hello world")).toEqual([]);
    expect(numericFields("")).toEqual([]);
  });

  it("ignores non-finite numbers", () => {
    // NaN/Infinity can't appear in valid JSON, but guard anyway via JSON path
    expect(numericFields('{"a":1e999}')).toEqual([]); // Infinity
  });
});

describe("valueAtPath", () => {
  it("reads nested numeric values", () => {
    expect(valueAtPath('{"sensor":{"rssi":-72}}', "sensor.rssi")).toBe(-72);
  });
  it("reads a bare numeric payload at empty path", () => {
    expect(valueAtPath("42.5", "")).toBe(42.5);
  });
  it("reads quoted numeric values as numbers", () => {
    expect(valueAtPath('{"temp":"24.6"}', "temp")).toBe(24.6);
    expect(valueAtPath('"42.5"', "")).toBe(42.5);
  });
  it("reads EU-style decimal commas as numbers", () => {
    expect(valueAtPath('{"temp":"24,6"}', "temp")).toBe(24.6);
    expect(valueAtPath('"42,5"', "")).toBe(42.5);
  });
  it("returns null when path is missing or non-numeric", () => {
    expect(valueAtPath('{"a":1}', "b")).toBeNull();
    expect(valueAtPath('{"a":"x"}', "a")).toBeNull();
    expect(valueAtPath("not json", "a")).toBeNull();
  });
});

describe("payloadTree", () => {
  it("builds a nested tree with leaf types", () => {
    const tree = payloadTree('{"temp":24.6,"sensor":{"rssi":-72},"name":"x"}');
    expect(tree?.type).toBe("object");
    const temp = tree?.children?.find((c) => c.key === "temp");
    expect(temp?.type).toBe("number");
    expect(temp?.value).toBe(24.6);
    const sensor = tree?.children?.find((c) => c.key === "sensor");
    expect(sensor?.type).toBe("object");
    expect(sensor?.children?.[0].path).toBe("sensor.rssi");
    const name = tree?.children?.find((c) => c.key === "name");
    expect(name?.type).toBe("string");
    expect(name?.chartable).toBeUndefined();
  });
  it("marks numeric-string leaves as chartable but keeps string type", () => {
    const tree = payloadTree('{"temp":"24.6","name":"kitchen"}');
    const temp = tree?.children?.find((c) => c.key === "temp");
    expect(temp?.type).toBe("string");
    expect(temp?.value).toBe("24.6");
    expect(temp?.chartable).toBe(true);
    const name = tree?.children?.find((c) => c.key === "name");
    expect(name?.chartable).toBeUndefined();
  });
  it("marks numeric leaves as chartable", () => {
    const tree = payloadTree('{"temp":24.6}');
    const temp = tree?.children?.find((c) => c.key === "temp");
    expect(temp?.chartable).toBe(true);
  });
  it("returns null for non-JSON", () => {
    expect(payloadTree("nope")).toBeNull();
  });
  it("wraps a bare value as a single leaf", () => {
    const tree = payloadTree("7");
    expect(tree?.type).toBe("number");
    expect(tree?.value).toBe(7);
    expect(tree?.path).toBe("");
  });
});

describe("hasNumericFields", () => {
  it("is true with numbers, false otherwise", () => {
    expect(hasNumericFields('{"a":1}')).toBe(true);
    expect(hasNumericFields('{"a":"x"}')).toBe(false);
    expect(hasNumericFields("42")).toBe(true);
    expect(hasNumericFields("text")).toBe(false);
    expect(hasNumericFields('{"a":"3.14"}')).toBe(true);
  });
});
