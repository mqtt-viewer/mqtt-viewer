// Shared topic matching for the search/filter boxes. Pure, framework-agnostic.
//
// A query matches a topic when it is a case-insensitive substring of the topic
// (or of any extra haystack the caller supplies, e.g. the decoded payload in the
// List view), OR — when the query looks like an MQTT topic filter (contains `+`
// or `#`) and is a valid one — when it matches the topic as an MQTT
// subscription. The List view feeds payloads in as extra haystacks; the Graph
// view passes none (it stores no payloads).

// Does `subscription` (an MQTT topic filter with `+`/`#` wildcards) match
// `topic`? Both are compared level by level on `/`.
export const topicMatchesSubscription = (
  topic: string,
  subscription: string
): boolean => {
  const topicLevels = topic.split("/");
  const subscriptionLevels = subscription.split("/");

  for (let i = 0; i < subscriptionLevels.length; i++) {
    const subLevel = subscriptionLevels[i];
    const topicLevel = topicLevels[i];

    if (subLevel === "#") {
      // Multi-level wildcard matches any remaining levels
      return true;
    }

    if (subLevel === "+") {
      // Single-level wildcard matches exactly one level
      continue;
    }

    if (subLevel !== topicLevel) {
      // If levels do not match and it's not a wildcard, return false
      return false;
    }
  }

  // If the subscription is shorter than the topic, it doesn't match
  return topicLevels.length === subscriptionLevels.length;
};

// Is `topic` a valid MQTT topic filter? `#` must be the final level; `+` and
// `#` may not be embedded within a level.
export const validateTopic = (topic: string): boolean => {
  const parts = topic.split("/");

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "+") {
      continue;
    }

    if (parts[i] === "#") {
      // # is only valid as the last level
      return i === parts.length - 1;
    }

    if (parts[i].indexOf("+") !== -1 || parts[i].indexOf("#") !== -1) {
      return false;
    }
  }

  return true;
};

// The substring-vs-wildcard dispatch shared by both views. `topic` and
// `extraHaystacks` are matched as case-insensitive substrings of `query`; when
// `query` is a valid MQTT pattern the topic is additionally tried as an MQTT
// subscription. An empty query matches everything.
export const topicMatchesQuery = (
  topic: string,
  query: string,
  extraHaystacks: string[] = []
): boolean => {
  const q = query.toLowerCase();
  if (!q) {
    return true;
  }

  const lowerTopic = topic.toLowerCase();
  const substringMatch =
    lowerTopic.includes(q) ||
    extraHaystacks.some((h) => h.toLowerCase().includes(q));

  const queryIsMqttPattern = q.includes("#") || q.includes("+");
  if (!queryIsMqttPattern) {
    return substringMatch;
  }

  if (!validateTopic(q)) {
    return substringMatch;
  }

  return substringMatch || topicMatchesSubscription(lowerTopic, q);
};
