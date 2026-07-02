// Detects image payloads from their raw (base64) bytes so the payload tab
// can render a preview instead of mangled text (issue #35).

export interface DetectedImage {
  mime: string;
  label: string;
}

// Decode just enough base64 to inspect magic bytes. Returns null when the
// payload isn't valid base64 (e.g. already-decoded text sneaks in).
const headBytes = (b64: string, count: number): Uint8Array | null => {
  // 4 base64 chars per 3 bytes, padded to a multiple of 4.
  const chars = Math.ceil((count / 3) * 4);
  const head = b64.slice(0, chars + 4 - ((chars + 4) % 4 || 4));
  try {
    const bin = atob(head.length >= chars ? head : b64);
    const bytes = new Uint8Array(Math.min(bin.length, count));
    for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0): boolean => {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
};

export const detectImage = (payloadB64: string | null): DetectedImage | null => {
  if (!payloadB64) return null;
  const bytes = headBytes(payloadB64, 16);
  if (!bytes || bytes.length < 4) return null;

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return { mime: "image/png", label: "PNG" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", label: "JPEG" };
  }
  // GIF87a / GIF89a
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { mime: "image/gif", label: "GIF" };
  }
  // RIFF....WEBP
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { mime: "image/webp", label: "WebP" };
  }
  // BM (BMP) — require the two magic bytes plus a plausible header length
  if (startsWith(bytes, [0x42, 0x4d]) && bytes.length >= 14) {
    return { mime: "image/bmp", label: "BMP" };
  }
  return null;
};

export const imageDataUrl = (payloadB64: string, mime: string): string =>
  `data:${mime};base64,${payloadB64}`;

// Approximate decoded byte size of a base64 string.
export const base64ByteSize = (b64: string): number => {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
};

export const formatByteSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
