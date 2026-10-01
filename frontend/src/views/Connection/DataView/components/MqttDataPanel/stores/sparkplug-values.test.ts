import { describe, it, expect } from "vitest";
import {
  datatypeName,
  decodeArray,
  formatFloat32,
  formatMetricValue,
  qualityLabel,
  readMetricProperties,
} from "./sparkplug-values";

const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");

describe("formatMetricValue", () => {
  it("reads signed integers out of their two's complement wire form", () => {
    expect(formatMetricValue({ intValue: 255 }, 1).value).toBe("-1");
    expect(formatMetricValue({ intValue: 4294967295 }, 1).value).toBe("-1");
    expect(formatMetricValue({ intValue: 65535 }, 2).value).toBe("-1");
    expect(formatMetricValue({ intValue: 4294967291 }, 3).value).toBe("-5");
    expect(formatMetricValue({ intValue: 127 }, 1).value).toBe("127");
    expect(formatMetricValue({ intValue: 4294967295 }, 7).value).toBe("4294967295");
  });

  it("keeps 64-bit integers exact and signs Int64", () => {
    expect(formatMetricValue({ longValue: "18446744073709551615" }, 4).value).toBe("-1");
    expect(formatMetricValue({ longValue: "18446744073709551615" }, 8).value).toBe(
      "18446744073709551615"
    );
    expect(formatMetricValue({ longValue: "9007199254740993" }, 4).value).toBe(
      "9007199254740993"
    );
  });

  it("prints floats as the device sent them, doubles in full", () => {
    // 239.1 as a float32, widened to a double on the way through protojson.
    const widened = Math.fround(239.1);
    expect(formatMetricValue({ floatValue: widened }, 9).value).toBe("239.1");
    expect(formatMetricValue({ doubleValue: 152340.5 }, 10).value).toBe("152340.5");
    expect(formatMetricValue({ doubleValue: 0.1 + 0.2 }, 10).value).toBe(String(0.1 + 0.2));
    expect(formatMetricValue({ floatValue: "NaN" }, 9).value).toBe("NaN");
  });

  it("formats DateTime as local time with its offset, copying ISO 8601", () => {
    const ms = new Date(2026, 8, 23, 14, 5, 9, 120).getTime();
    const formatted = formatMetricValue({ longValue: String(ms) }, 13);
    expect(formatted.value).toMatch(/^2026-09-23 14:05:09\.120 [+-]\d\d:\d\d$/);
    expect(formatted.raw).toBe(new Date(ms).toISOString());
  });

  it("shows empty and multi-line strings for what they are", () => {
    expect(formatMetricValue({ stringValue: "" }, 12).value).toBe('""');
    const multi = formatMetricValue({ stringValue: "a\nb" }, 12);
    expect(multi.value).toBe("a \u21b5 b");
    expect(multi.raw).toBe("a\nb");
    expect(formatMetricValue({ floatValue: -0 }, 9).value).toBe("-0");
  });

  it("summarises bytes, files, datasets and templates", () => {
    expect(formatMetricValue({ bytesValue: b64([1, 2, 3]) }, 17).value).toBe("3 bytes");
    expect(formatMetricValue({ bytesValue: b64([1]) }, 18).value).toBe("File, 1 byte");
    const ds = formatMetricValue(
      { datasetValue: { numOfColumns: "2", columns: ["a", "b"], rows: [{}, {}, {}] } },
      16
    );
    expect(ds.value).toBe("3 rows, 2 columns");
    expect(JSON.parse(ds.raw).columns).toEqual(["a", "b"]);
    expect(
      formatMetricValue({ templateValue: { templateRef: "Motor", metrics: [{}, {}] } }, 19).value
    ).toBe("Motor, 2 metrics");
    expect(
      formatMetricValue({ templateValue: { isDefinition: true, metrics: [{}] } }, 19).value
    ).toBe("definition, 1 metric");
  });

  it("decodes arrays and previews the first few elements", () => {
    // Int16Array [1, -2] little-endian.
    expect(formatMetricValue({ bytesValue: b64([1, 0, 0xfe, 0xff]) }, 23).value).toBe(
      "[1, -2]"
    );
    const bytes = [];
    for (let i = 0; i < 10; i++) bytes.push(i);
    const long = formatMetricValue({ bytesValue: b64(bytes) }, 26);
    expect(long.value).toBe("[0, 1, 2, 3, 4, 5, 6, 7, and 2 more]");
    expect(JSON.parse(long.raw)).toHaveLength(10);
    // Numeric arrays copy as numbers.
    expect(JSON.parse(long.raw)[3]).toBe(3);
    // A byte count that doesn't fit the element size falls back to a size.
    expect(formatMetricValue({ bytesValue: b64([1, 2, 3]) }, 24).value).toBe("3 bytes");
  });

  it("reads null before any value field", () => {
    expect(formatMetricValue({ isNull: true, intValue: 3 }, 3).value).toBe("null");
  });

  it("treats a Boolean carried as an int as a boolean", () => {
    expect(formatMetricValue({ intValue: 1 }, 11).value).toBe("true");
  });
});

describe("decodeArray", () => {
  it("unpacks boolean arrays most significant bit first after a count", () => {
    // count 3, bits 101xxxxx
    expect(decodeArray(32, b64([3, 0, 0, 0, 0b10100000]))).toEqual([true, false, true]);
    expect(decodeArray(32, b64([9, 0, 0, 0, 0xff]))).toBeNull();
  });

  it("splits string arrays on null terminators", () => {
    const enc = new TextEncoder();
    const bytes = [...enc.encode("ab"), 0, ...enc.encode("c"), 0];
    expect(decodeArray(33, b64(bytes))).toEqual(["ab", "c"]);
  });

  it("reads 64-bit and float arrays", () => {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setBigInt64(0, BigInt(-3), true);
    expect(decodeArray(25, b64([...new Uint8Array(buf.buffer)]))).toEqual(["-3"]);
    const f = new DataView(new ArrayBuffer(4));
    f.setFloat32(0, 1.1, true);
    expect(decodeArray(30, b64([...new Uint8Array(f.buffer)]))).toEqual(["1.1"]);
  });
});

describe("formatFloat32", () => {
  it("finds the shortest round-tripping decimal", () => {
    expect(formatFloat32(Math.fround(0.1))).toBe("0.1");
    expect(formatFloat32(Math.fround(123456.7))).toBe("123456.7");
    expect(formatFloat32(Infinity)).toBe("Infinity");
  });
});

describe("readMetricProperties", () => {
  it("finds the unit under any of its usual names", () => {
    for (const key of ["engUnit", "engUnits", "EngineeringUnits", "units"]) {
      expect(
        readMetricProperties({
          properties: { keys: [key], values: [{ stringValue: " kWh " }] },
        }).unit
      ).toBe("kWh");
    }
  });

  it("reads the quality code", () => {
    expect(
      readMetricProperties({
        properties: { keys: ["Quality"], values: [{ intValue: 500 }] },
      }).quality
    ).toBe(500);
  });

  it("tolerates missing or mismatched properties", () => {
    expect(readMetricProperties({})).toEqual({});
    expect(readMetricProperties({ properties: { keys: ["engUnit"] } })).toEqual({});
  });
});

describe("qualityLabel", () => {
  it("labels OPC ranges and Ignition's stale code", () => {
    expect(qualityLabel(192)).toBeNull();
    expect(qualityLabel(undefined)).toBeNull();
    expect(qualityLabel(0)).toBe("bad");
    expect(qualityLabel(100)).toBe("uncertain");
    expect(qualityLabel(500)).toBe("stale");
    expect(qualityLabel(9999)).toBe("quality 9999");
  });
});

describe("datatypeName", () => {
  it("names every Sparkplug datatype and falls back for unknown ones", () => {
    expect(datatypeName(16)).toBe("DataSet");
    expect(datatypeName(34)).toBe("DateTimeArray");
    expect(datatypeName(99)).toBe("Type 99");
    expect(datatypeName(undefined)).toBe("");
  });
});
