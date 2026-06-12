export type SupportedCodeEditorCodec = "none" | "base64" | "hex";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const bytesToUtf8 = (bytes: Uint8Array, fallback: string): string => {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return fallback;
  }
};

export const base64ToUtf8 = (b64: string): string => {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return bytesToUtf8(bytes, binary);
};

const utf8ToBinaryString = (payload: string): string => {
  const bytes = new TextEncoder().encode(payload);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return binary;
};

export const encodePayload = (
  payload: string,
  codec: SupportedCodeEditorCodec
) => {
  if (codec === "none") {
    return payload;
  }

  if (codec === "base64") {
    return btoa(utf8ToBinaryString(payload));
  }

  if (codec === "hex") {
    return Array.from(new TextEncoder().encode(payload))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  return payload;
};

export const decodePayload = (
  payload: string,
  codec: SupportedCodeEditorCodec
) => {
  if (codec === "none") {
    return payload;
  }

  if (codec === "base64") {
    try {
      return base64ToUtf8(payload);
    } catch (e) {
      throw e;
    }
  }

  if (codec === "hex") {
    try {
      const binary = payload
        .split(/(\w\w)/g)
        .filter((p) => !!p)
        .map((c) => String.fromCharCode(parseInt(c, 16)))
        .join("");
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return bytesToUtf8(bytes, binary);
    } catch (e) {
      throw e;
    }
  }

  return payload;
};
