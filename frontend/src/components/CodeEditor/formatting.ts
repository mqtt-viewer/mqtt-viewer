export type SupportedCodeEditorFormat = "none" | "json" | "json-prettier";

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

  return payload;
};
