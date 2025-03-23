export type SupportCodeEditorCodec = "none" | "base64" | "hex";

export const encodePayload = (
  payload: string,
  codec: SupportCodeEditorCodec
) => {
  if (codec === "none") {
    return payload;
  }

  if (codec === "base64") {
    return btoa(payload);
  }

  if (codec === "hex") {
    return payload
      .split("")
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  }

  return payload;
};

export const decodePayload = (
  payload: string,
  codec: SupportCodeEditorCodec
) => {
  if (codec === "none") {
    return payload;
  }

  if (codec === "base64") {
    try {
      return atob(payload);
    } catch (e) {
      throw e;
    }
  }

  if (codec === "hex") {
    try {
      return payload
        .split(/(\w\w)/g)
        .filter((p) => !!p)
        .map((c) => String.fromCharCode(parseInt(c, 16)))
        .join("");
    } catch (e) {
      throw e;
    }
  }

  return payload;
};
