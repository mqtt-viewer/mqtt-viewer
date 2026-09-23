// Display formatting for Sparkplug B metric values, as they arrive in the
// backend's protojson rendering of the payload.
//
// The wire format only has a handful of value fields (int_value is a uint32,
// long_value a uint64, and so on), so the datatype decides what the bits mean:
// a signed Int8/16/32/64 is carried as its two's complement in the unsigned
// field, a DateTime is epoch milliseconds in long_value, and every array type
// is a little-endian packing in bytes_value. Formatting by field alone would
// show -1 as 4294967295, so every value goes through the datatype here.
//
// Data messages usually omit the datatype (it is declared once, in the birth),
// so callers pass the datatype remembered from the birth when the metric
// itself doesn't carry one.

/** Protojson metric shape (names already injected by the backend). */
export interface PayloadMetric {
  name?: string;
  alias?: string | number;
  timestamp?: string | number;
  datatype?: number;
  isHistorical?: boolean;
  isTransient?: boolean;
  isNull?: boolean;
  properties?: PropertySet;
  intValue?: number;
  longValue?: string | number;
  floatValue?: number | string;
  doubleValue?: number | string;
  booleanValue?: boolean;
  stringValue?: string;
  bytesValue?: string;
  datasetValue?: DataSetValue;
  templateValue?: TemplateValue;
}

export interface PropertySet {
  keys?: string[];
  values?: PropertyValue[];
}

export interface PropertyValue {
  type?: number;
  isNull?: boolean;
  intValue?: number;
  longValue?: string | number;
  floatValue?: number | string;
  doubleValue?: number | string;
  booleanValue?: boolean;
  stringValue?: string;
}

interface DataSetValue {
  numOfColumns?: string | number;
  columns?: string[];
  types?: number[];
  rows?: unknown[];
}

interface TemplateValue {
  templateRef?: string;
  isDefinition?: boolean;
  metrics?: unknown[];
}

export const DATATYPE_NAMES: Record<number, string> = {
  1: "Int8",
  2: "Int16",
  3: "Int32",
  4: "Int64",
  5: "UInt8",
  6: "UInt16",
  7: "UInt32",
  8: "UInt64",
  9: "Float",
  10: "Double",
  11: "Boolean",
  12: "String",
  13: "DateTime",
  14: "Text",
  15: "UUID",
  16: "DataSet",
  17: "Bytes",
  18: "File",
  19: "Template",
  20: "PropertySet",
  21: "PropertySetList",
  22: "Int8Array",
  23: "Int16Array",
  24: "Int32Array",
  25: "Int64Array",
  26: "UInt8Array",
  27: "UInt16Array",
  28: "UInt32Array",
  29: "UInt64Array",
  30: "FloatArray",
  31: "DoubleArray",
  32: "BooleanArray",
  33: "StringArray",
  34: "DateTimeArray",
};

export const datatypeName = (code: number | undefined): string => {
  if (code === undefined || code === null) return "";
  return DATATYPE_NAMES[code] ?? `Type ${code}`;
};

export interface FormattedValue {
  /** What the row shows. Exact for every scalar type. */
  value: string;
  /** What copy puts on the clipboard: the full value, never abbreviated. */
  raw: string;
}

const TWO_64 = BigInt("18446744073709551616");
const TWO_63 = BigInt("9223372036854775808");

const toBigInt = (v: string | number): bigint | null => {
  try {
    return BigInt(typeof v === "number" ? Math.trunc(v) : v);
  } catch {
    return null;
  }
};

/** Reinterprets the low `bits` of an unsigned wire integer as signed. */
const signed32 = (v: number, bits: 8 | 16 | 32): number => {
  if (bits === 32) return v | 0;
  const mask = (1 << bits) - 1;
  const low = v & mask;
  return low >= 1 << (bits - 1) ? low - (1 << bits) : low;
};

/**
 * The shortest decimal that reads back as the same float32. A Float metric
 * of 239.1 arrives as 239.10000610351562 once widened to a double; printing
 * that would invent digits the device never sent.
 */
export const formatFloat32 = (n: number): string => {
  if (!Number.isFinite(n)) return String(n);
  const target = Math.fround(n);
  for (let p = 1; p <= 9; p++) {
    const candidate = Number(n.toPrecision(p));
    if (Math.fround(candidate) === target) return String(candidate);
  }
  return String(n);
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Local wall-clock time with milliseconds: 2026-09-23 14:05:09.120. */
export const formatDateTime = (ms: number): string => {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
};

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * Decodes a Sparkplug 3.0 array value (little-endian packing in bytes_value).
 * Returns null when the bytes don't fit the type, so the caller can fall back
 * to showing the byte count.
 */
export const decodeArray = (
  datatype: number,
  b64: string
): (number | string | boolean)[] | null => {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64);
  } catch {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read = (
    size: number,
    get: (offset: number) => number | string
  ): (number | string)[] | null => {
    if (bytes.length % size !== 0) return null;
    const out: (number | string)[] = [];
    for (let o = 0; o < bytes.length; o += size) out.push(get(o));
    return out;
  };
  switch (datatype) {
    case 22:
      return read(1, (o) => view.getInt8(o));
    case 23:
      return read(2, (o) => view.getInt16(o, true));
    case 24:
      return read(4, (o) => view.getInt32(o, true));
    case 25:
      return read(8, (o) => view.getBigInt64(o, true).toString());
    case 26:
      return read(1, (o) => view.getUint8(o));
    case 27:
      return read(2, (o) => view.getUint16(o, true));
    case 28:
      return read(4, (o) => view.getUint32(o, true));
    case 29:
      return read(8, (o) => view.getBigUint64(o, true).toString());
    case 30:
      return read(4, (o) => formatFloat32(view.getFloat32(o, true)));
    case 31:
      return read(8, (o) => String(view.getFloat64(o, true)));
    case 34:
      return read(8, (o) => formatDateTime(Number(view.getBigInt64(o, true))));
    case 32: {
      // A uint32 count, then the booleans packed most significant bit first.
      if (bytes.length < 4) return null;
      const count = view.getUint32(0, true);
      if (Math.ceil(count / 8) > bytes.length - 4) return null;
      const out: boolean[] = [];
      for (let i = 0; i < count; i++) {
        out.push(((bytes[4 + (i >> 3)] >> (7 - (i & 7))) & 1) === 1);
      }
      return out;
    }
    case 33: {
      // Null-terminated UTF-8 strings, back to back.
      const out: string[] = [];
      const decoder = new TextDecoder();
      let start = 0;
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) {
          out.push(decoder.decode(bytes.subarray(start, i)));
          start = i + 1;
        }
      }
      if (start < bytes.length) out.push(decoder.decode(bytes.subarray(start)));
      return out;
    }
  }
  return null;
};

/** Array elements shown inline before the rest are summarised. */
const ARRAY_PREVIEW = 8;

const formatArray = (datatype: number, b64: string): FormattedValue => {
  const items = decodeArray(datatype, b64);
  if (items === null) {
    const size = byteLength(b64);
    return { value: `${size} bytes`, raw: b64 };
  }
  const shown = items.slice(0, ARRAY_PREVIEW).map((v) => String(v));
  const more = items.length - shown.length;
  return {
    value: `[${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}]`,
    raw: JSON.stringify(items),
  };
};

const byteLength = (b64: string): number => {
  const trimmed = b64.replace(/=+$/, "");
  return Math.floor((trimmed.length * 3) / 4);
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const asNumber = (v: number | string): number =>
  typeof v === "number" ? v : Number(v);

/**
 * Formats a metric's value for display. `datatype` is the metric's own
 * datatype or, when a data message omits it, the one declared in the birth.
 */
export const formatMetricValue = (
  m: PayloadMetric,
  datatype: number | undefined
): FormattedValue => {
  if (m.isNull) return { value: "null", raw: "null" };
  const dt = m.datatype ?? datatype;

  if (m.intValue !== undefined) {
    let n = m.intValue;
    if (dt === 1) n = signed32(n, 8);
    else if (dt === 2) n = signed32(n, 16);
    else if (dt === 3) n = signed32(n, 32);
    else n = n >>> 0;
    if (dt === 11) return { value: String(n !== 0), raw: String(n !== 0) };
    return { value: String(n), raw: String(n) };
  }

  if (m.longValue !== undefined) {
    const big = toBigInt(m.longValue);
    if (big === null) return { value: String(m.longValue), raw: String(m.longValue) };
    if (dt === 13) {
      const ms = Number(big);
      return { value: formatDateTime(ms), raw: String(ms) };
    }
    // Int64 and the smaller signed types all ride in long_value as two's
    // complement when a publisher puts them there.
    const isSigned = dt === 1 || dt === 2 || dt === 3 || dt === 4;
    const n = isSigned && big >= TWO_63 ? big - TWO_64 : big;
    return { value: n.toString(), raw: n.toString() };
  }

  if (m.floatValue !== undefined) {
    const n = asNumber(m.floatValue);
    return { value: formatFloat32(n), raw: String(n) };
  }

  if (m.doubleValue !== undefined) {
    const n = asNumber(m.doubleValue);
    return { value: String(n), raw: String(n) };
  }

  if (m.booleanValue !== undefined) {
    return { value: String(m.booleanValue), raw: String(m.booleanValue) };
  }

  if (m.stringValue !== undefined) {
    return { value: m.stringValue, raw: m.stringValue };
  }

  if (m.bytesValue !== undefined) {
    if (dt !== undefined && dt >= 22 && dt <= 34) return formatArray(dt, m.bytesValue);
    const size = byteLength(m.bytesValue);
    return {
      value: dt === 18 ? `File, ${plural(size, "byte")}` : plural(size, "byte"),
      raw: m.bytesValue,
    };
  }

  if (m.datasetValue !== undefined) {
    const ds = m.datasetValue;
    const rows = ds.rows?.length ?? 0;
    const cols = Number(ds.numOfColumns ?? ds.columns?.length ?? 0);
    return {
      value: `${plural(rows, "row")}, ${plural(cols, "column")}`,
      raw: JSON.stringify(ds),
    };
  }

  if (m.templateValue !== undefined) {
    const t = m.templateValue;
    const count = t.metrics?.length ?? 0;
    const kind = t.isDefinition ? "definition" : (t.templateRef ?? "instance");
    return {
      value: `${kind}, ${plural(count, "metric")}`,
      raw: JSON.stringify(t),
    };
  }

  return { value: "", raw: "" };
};

// --- Properties ---------------------------------------------------------------

// Engineering units go by several names depending on the stack: Ignition
// writes "engUnit", Tahu examples "engUnits", others spell it out.
const UNIT_KEYS = new Set([
  "engunit",
  "engunits",
  "engineeringunits",
  "engineeringunit",
  "units",
  "unit",
]);
const QUALITY_KEYS = new Set(["quality"]);

const propertyScalar = (v: PropertyValue): string | number | undefined => {
  if (v.isNull) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return v.intValue;
  if (v.longValue !== undefined) return Number(v.longValue);
  if (v.floatValue !== undefined) return asNumber(v.floatValue);
  if (v.doubleValue !== undefined) return asNumber(v.doubleValue);
  if (v.booleanValue !== undefined) return String(v.booleanValue);
  return undefined;
};

export interface MetricProperties {
  unit?: string;
  quality?: number;
}

/** Pulls the engineering unit and quality code out of a metric's properties. */
export const readMetricProperties = (m: PayloadMetric): MetricProperties => {
  const out: MetricProperties = {};
  const keys = m.properties?.keys;
  const values = m.properties?.values;
  if (!keys || !values) return out;
  for (let i = 0; i < keys.length && i < values.length; i++) {
    const key = keys[i].toLowerCase();
    if (UNIT_KEYS.has(key)) {
      const v = propertyScalar(values[i]);
      if (v !== undefined && String(v).trim() !== "") out.unit = String(v).trim();
    } else if (QUALITY_KEYS.has(key)) {
      const v = propertyScalar(values[i]);
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out.quality = n;
    }
  }
  return out;
};

/**
 * A short label for a quality code, or null when the value is good. Codes
 * follow OPC DA ranges (0-63 bad, 64-191 uncertain, 192-255 good), which is
 * what Ignition and most OPC-bridging edge nodes publish, plus Ignition's own
 * 500 for stale.
 */
export const qualityLabel = (code: number | undefined): string | null => {
  if (code === undefined) return null;
  if (code === 500) return "stale";
  if (code >= 192 && code <= 255) return null;
  if (code >= 64 && code <= 191) return "uncertain";
  if (code >= 0 && code <= 63) return "bad";
  return `quality ${code}`;
};
