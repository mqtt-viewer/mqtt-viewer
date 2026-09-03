// The Wails runtime rejects a failed binding call with an Error whose message
// is a JSON object, like {"message":"...","kind":"RuntimeError"}. Toasts and
// error fields want the sentence inside it, and they want a string whatever
// was thrown, so nothing downstream calls a string method on an object.
export const errorMessage = (e: unknown): string => {
  if (!(e instanceof Error)) return String(e);
  return wrappedMessage(e.message) ?? e.message;
};

// The `message` field of a JSON error body, or null when the text is not that.
const wrappedMessage = (text: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { message?: unknown }).message === "string"
    ) {
      return (parsed as { message: string }).message;
    }
  } catch {
    // not JSON, so the raw text is the message
  }
  return null;
};
