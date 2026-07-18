// Builds the payload preview shown in the timeline hover tooltip. Payloads can
// be very large, so the preview is always capped to keep the popover light and
// the DOM bounded.

export const PAYLOAD_PREVIEW_CAP = 500;

// Marker appended when the payload is longer than the cap.
const TRUNCATION_MARKER = "…";

// Returns a bounded preview of a decoded payload string. Short payloads pass
// through unchanged; anything past the cap is trimmed and marked with an
// ellipsis so the user knows there is more.
export const previewPayload = (
  payload: string,
  cap: number = PAYLOAD_PREVIEW_CAP
): string => {
  if (!payload) return "";
  if (payload.length <= cap) return payload;
  return payload.slice(0, cap) + TRUNCATION_MARKER;
};
