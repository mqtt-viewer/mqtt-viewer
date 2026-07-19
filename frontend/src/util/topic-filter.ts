// Mirrors backend/topic-matching/proto_binding_matcher.go's
// ValidateTopicFilter. Returns null when filter is a valid proto binding
// topic filter, otherwise one of the approved copy strings from the
// per-topic-protobuf design doc.
export const validateTopicFilter = (filter: string): string | null => {
  if (!filter || filter.trim() !== filter || filter.includes("\0")) {
    return "Enter a topic filter";
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
