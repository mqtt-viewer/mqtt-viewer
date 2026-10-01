export const capitalizeFirstLetter = (string?: string) => {
  if (!string || string === "") return;
  return string?.charAt(0)?.toUpperCase() + string?.slice(1);
};

/**
 * A Go error returned from a binding reaches the frontend as the JSON of
 * the runtime's error envelope, `{"message": ..., "cause": ..., "kind":
 * "RuntimeError"}`. Pull the message out so a toast reads like a sentence.
 * Anything else passes through untouched.
 */
const unwrapRuntimeError = (s: string): string => {
  if (!s.startsWith("{")) return s;
  try {
    const parsed = JSON.parse(s);
    if (typeof parsed?.message === "string" && parsed.message !== "") return parsed.message;
  } catch (_) {
    // not JSON after all
  }
  return s;
};

/**
 * Safely turn an unknown catch value into display text.
 *
 * A rejected binding call can reject with anything, not just a string, so
 * `catch (e) { description: e as string }` is a lie the type system doesn't
 * catch. Handing a non-string to capitalizeFirstLetter then crashes on
 * `.charAt`, taking the error toast down along with the error it was
 * reporting. Never throws.
 */
export const errorMessage = (e: unknown): string => {
  if (typeof e === "string") return unwrapRuntimeError(e);
  // Bindings reject with an Error whose message is the envelope's JSON.
  if (e instanceof Error) return unwrapRuntimeError(e.message);
  if (e === null || e === undefined) return "Unknown error";
  try {
    const json = JSON.stringify(e);
    // undefined for a value JSON can't represent, "{}" for an object whose
    // own properties are all non-enumerable: neither tells the user anything.
    if (json !== undefined && json !== "{}") return json;
  } catch (_) {
    // circular reference; String() below still gives something printable
  }
  return String(e);
};
