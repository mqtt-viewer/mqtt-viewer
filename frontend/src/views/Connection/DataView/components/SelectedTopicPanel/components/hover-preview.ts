// Builds the payload preview shown in the timeline hover popover. Payloads can
// be very large or binary, so the preview is always capped and non-printable
// content is either substituted with visible glyphs or summarised.

import { base64ByteSize, detectImage, formatByteSize } from "./image-payload";

export const PAYLOAD_PREVIEW_CAP = 500;

// Marker appended when the payload is longer than the cap.
const TRUNCATION_MARKER = "…";

// Control characters with no visible rendering. Tab, LF and CR are excluded
// because the preview renders whitespace-pre-wrap.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// Characters that mark a payload as binary rather than text: raw control
// characters plus U+FFFD, which utf8 decoding substitutes for invalid bytes.
const BINARY_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffd]/g;

// How much of the payload is sampled for binary detection, and the ratio of
// binary characters above which it stops being treated as text.
const BINARY_SAMPLE_SIZE = 512;
const BINARY_RATIO_THRESHOLD = 0.1;

// Maps an invisible control character to its Unicode Control Picture so lone
// control characters in otherwise-textual payloads stay visible.
const controlGlyph = (char: string): string => {
  const code = char.charCodeAt(0);
  return String.fromCharCode(code === 0x7f ? 0x2421 : 0x2400 + code);
};

// Returns a bounded preview of a decoded payload string. Short payloads pass
// through unchanged; anything past the cap is trimmed and marked with an
// ellipsis so the user knows there is more. Invisible control characters are
// substituted with visible glyphs.
export const previewPayload = (
  payload: string,
  cap: number = PAYLOAD_PREVIEW_CAP
): string => {
  if (!payload) return "";
  const visible = payload.replace(CONTROL_CHARS, controlGlyph);
  if (visible.length <= cap) return visible;
  return visible.slice(0, cap) + TRUNCATION_MARKER;
};

// True when a decoded payload is mostly non-printable, i.e. binary bytes were
// forced through utf8 decoding and rendering them as text would be mojibake.
export const isBinaryPayload = (payload: string): boolean => {
  if (!payload) return false;
  const sample = payload.slice(0, BINARY_SAMPLE_SIZE);
  const matches = sample.match(BINARY_CHARS);
  if (!matches) return false;
  return matches.length / sample.length > BINARY_RATIO_THRESHOLD;
};

// Terse one-line summary for a binary payload, e.g. "PNG image (12.3 KB)" or
// "Binary payload (1.2 KB)". Mirrors the payload tab's image detection.
export const binaryPayloadSummary = (payloadB64: string): string => {
  const size = formatByteSize(base64ByteSize(payloadB64));
  const image = detectImage(payloadB64);
  return image ? `${image.label} image (${size})` : `Binary payload (${size})`;
};

export type PayloadPreview =
  | { kind: "text"; text: string }
  | { kind: "binary"; summary: string };

// Single entry point for the popover: binary payloads collapse to a summary
// line, textual ones get the capped, glyph-substituted preview.
export const buildPayloadPreview = (
  payload: string,
  payloadB64: string,
  cap: number = PAYLOAD_PREVIEW_CAP
): PayloadPreview => {
  if (isBinaryPayload(payload)) {
    return { kind: "binary", summary: binaryPayloadSummary(payloadB64) };
  }
  return { kind: "text", text: previewPayload(payload, cap) };
};

export const DEFAULT_POPOVER_MARGIN = 8;

export interface PopoverPositionInput {
  mouseX: number;
  mouseY: number;
  popoverWidth: number;
  popoverHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}

// Positions the popover in viewport coordinates: centred horizontally on the
// cursor, above it by default, flipping below when there is no room, and
// always clamped inside the viewport.
export const computePopoverPosition = ({
  mouseX,
  mouseY,
  popoverWidth,
  popoverHeight,
  viewportWidth,
  viewportHeight,
  margin = DEFAULT_POPOVER_MARGIN,
}: PopoverPositionInput): { left: number; top: number } => {
  let left = mouseX - popoverWidth / 2;
  left = Math.max(margin, Math.min(left, viewportWidth - popoverWidth - margin));
  let top = mouseY - popoverHeight - margin;
  if (top < margin) {
    top = mouseY + margin;
  }
  top = Math.max(margin, Math.min(top, viewportHeight - popoverHeight - margin));
  return { left, top };
};
