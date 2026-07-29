// Turns whatever a rejected Wails binding call throws into something worth
// showing a user.
//
// Wails doesn't throw a plain Error with a readable message. Depending on the
// call path it throws either a RuntimeError-shaped object
// (`{ message, cause, kind }`) or an Error whose own `.message` is that
// object serialised to JSON. Both used to reach the UI verbatim, so a failed
// import printed a JSON blob in red and a failed publish put one in a toast.
// Unwrap one layer of that so the backend's actual message comes through.
export const errorMessage = (e: unknown): string => {
  const raw =
    e instanceof Error
      ? e.message
      : e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
        ? (e as { message: string }).message
        : String(e ?? "");
  return unwrapSerialisedError(raw);
};

// A Wails error serialised to JSON, e.g.
// {"message":"publish: ...","cause":{},"kind":"RuntimeError"}. Anything that
// isn't that shape is returned untouched.
const unwrapSerialisedError = (message: string): string => {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return message;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.message === "string" && parsed.message) {
      return parsed.message;
    }
  } catch {
    // Not JSON after all; the original text is the best we have.
  }
  return message;
};
