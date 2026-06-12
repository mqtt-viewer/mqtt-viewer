export type SupportedCodeEditorFormat =
  | "none"
  | "json"
  | "json-prettier"
  | "hex";

export const formatPayload = (
  payload: string,
  format: SupportedCodeEditorFormat
) => {
  if (format === "json" || format === "none") {
    return payload;
  }

  if (format === "json-prettier") {
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch (e) {
      return payload;
    }
  }

  if (format === "hex") {
    const hasWideChars = [...payload].some((c) => c.codePointAt(0)! > 0xff);
    const bytes = hasWideChars
      ? new TextEncoder().encode(payload)
      : Uint8Array.from(payload, (c) => c.charCodeAt(0));
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      lines.push(
        Array.from(bytes.subarray(i, i + 16), (b) =>
          b.toString(16).padStart(2, "0")
        ).join(" ")
      );
    }
    return lines.join("\n");
  }

  return payload;
};
