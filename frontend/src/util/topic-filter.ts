// Mirrors backend/topic-matching/proto_binding_matcher.go's
// ValidateTopicFilter: same rules, same order, worded for the UI. Returns
// null when filter is a valid proto binding topic filter, otherwise the
// message to show under the field. Each rule gets its own message rather
// than collapsing into a single "Enter a topic filter", so a filter that
// merely has a trailing space says so.
export const validateTopicFilter = (filter: string): string | null => {
  if (!filter) {
    return "Enter a topic filter";
  }
  if (filter.includes("\0")) {
    return "No NUL bytes allowed";
  }
  if (filter.trim() !== filter) {
    return "No leading or trailing spaces";
  }
  if (filter.startsWith("$share/")) {
    return "Shared subscription filters can't be bindings";
  }

  const segments = filter.split("/");
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "#") {
      if (i !== segments.length - 1) {
        return "'#' must be the last segment";
      }
      continue;
    }
    if (segment.includes("#")) {
      return "'#' must be the last segment";
    }
    if (segment === "+") {
      continue;
    }
    if (segment.includes("+")) {
      return "'+' must be a whole segment";
    }
  }

  return null;
};
