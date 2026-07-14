// Utilities for turning a message payload into chartable numeric fields and a
// pickable tree. A "path" addresses a leaf: "" for a bare numeric payload,
// "temp" for a top-level key, "sensor.rssi" for nested, "vals.0" for arrays.

export interface NumericField {
  path: string;
  value: number;
}

export type PayloadNodeType =
  | "object"
  | "array"
  | "number"
  | "string"
  | "boolean"
  | "null";

export interface PayloadNode {
  key: string; // display label for this node ("" for root)
  path: string; // dotted/indexed path from root
  type: PayloadNodeType;
  value?: number | string | boolean | null; // for leaves
  chartable?: boolean; // leaf can be charted (a number, or a numeric string)
  children?: PayloadNode[];
}

const parse = (payload: string): unknown | undefined => {
  const trimmed = payload?.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

const joinPath = (base: string, key: string): string =>
  base === "" ? key : `${base}.${key}`;

const typeOf = (v: unknown): PayloadNodeType => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

// A string that is a plain decimal/scientific number and nothing else. Rejects
// empty/whitespace, hex ("0x1f"), Infinity/NaN, and unit-suffixed values ("24C").
const NUMERIC_STRING = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// Multiple comma-separated 3-digit groups: unambiguous thousands grouping
// ("1,000,000", "12,345,678").
const THOUSANDS_GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+$/;
// A single comma splitting an integer part from a trailing digit run.
const SINGLE_COMMA = /^[+-]?\d+,(\d+)$/;

/**
 * Coerces a leaf value to a finite number for charting. Numbers pass through;
 * quoted numerics (e.g. "24.6", "-72") are cast to float. Comma numbers are
 * read by the length of the run after the comma: a multiple of 3 ("1,000",
 * "1,000000") is thousands grouping, any other length ("12,1", "3,1416") is an
 * EU-style decimal separator. Everything else yields null.
 */
const coerceNumber = (v: unknown): number | null => {
  if (isFiniteNumber(v)) return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (NUMERIC_STRING.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
    if (trimmed.includes(",")) {
      const single = SINGLE_COMMA.exec(trimmed);
      // 3/6/9-digit runs (and properly grouped forms) read the comma as a
      // thousands separator; every other run length reads it as a decimal.
      if (THOUSANDS_GROUPED.test(trimmed) || (single && single[1].length % 3 === 0)) {
        const n = Number(trimmed.replace(/,/g, ""));
        if (Number.isFinite(n)) return n;
      } else if (single) {
        const n = Number(trimmed.replace(",", "."));
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
};

/**
 * Returns the numeric leaf fields of a payload. Numbers and quoted numerics
 * (e.g. "24.6") both count. A bare numeric payload yields a single field with
 * path "". Non-JSON (and JSON with no numbers) yields [].
 */
export function numericFields(payload: string): NumericField[] {
  const parsed = parse(payload);
  if (parsed === undefined) return [];
  const out: NumericField[] = [];
  const walk = (value: unknown, path: string) => {
    const num = coerceNumber(value);
    if (num !== null) {
      out.push({ path, value: num });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, joinPath(path, String(i))));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        walk(v, joinPath(path, k));
      }
    }
  };
  walk(parsed, "");
  return out;
}

/** Reads the numeric value at `path`; returns null if absent or non-numeric. */
export function valueAtPath(payload: string, path: string): number | null {
  const parsed = parse(payload);
  if (parsed === undefined) return null;
  let current: unknown = parsed;
  if (path !== "") {
    for (const segment of path.split(".")) {
      if (current === null || typeof current !== "object") return null;
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return coerceNumber(current);
}

/**
 * Builds a tree of the payload for the field picker. Returns null for non-JSON.
 * A bare value (number/string/etc.) is a single leaf node with key "value".
 */
export function payloadTree(payload: string): PayloadNode | null {
  const parsed = parse(payload);
  if (parsed === undefined) return null;
  const build = (value: unknown, key: string, path: string): PayloadNode => {
    const type = typeOf(value);
    if (type === "array") {
      return {
        key,
        path,
        type,
        children: (value as unknown[]).map((item, i) =>
          build(item, String(i), joinPath(path, String(i)))
        ),
      };
    }
    if (type === "object") {
      return {
        key,
        path,
        type,
        children: Object.entries(value as Record<string, unknown>).map(
          ([k, v]) => build(v, k, joinPath(path, k))
        ),
      };
    }
    const leaf: PayloadNode = {
      key,
      path,
      type,
      value: value as number | string | boolean | null,
    };
    if (coerceNumber(value) !== null) leaf.chartable = true;
    return leaf;
  };
  return build(parsed, "value", "");
}

/** True when the payload has at least one chartable numeric field. */
export function hasNumericFields(payload: string): boolean {
  return numericFields(payload).length > 0;
}
