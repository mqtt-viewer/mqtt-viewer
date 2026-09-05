export const capitalizeFirstLetter = (string?: string) => {
  if (!string || string === "") return;
  return string?.charAt(0)?.toUpperCase() + string?.slice(1);
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
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
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
