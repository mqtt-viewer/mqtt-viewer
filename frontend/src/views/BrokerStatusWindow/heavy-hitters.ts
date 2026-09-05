// Bounded "who is loudest" summary for the broker-status per-topic engine.
//
// Counting every topic exactly is not an option on a busy broker: a flood can
// carry thousands of distinct topics a second, and the hot path must stay O(1)
// per message with bounded memory. The old approach kept a capped map and threw
// away everything outside each second's top 16, which lost whole seconds for
// any topic that was not loud in that particular second and made the ranking
// depend on arrival order.
//
// This is Space-Saving (Metwally et al.), the standard fix. It keeps k
// counters. A message for a tracked topic bumps its counter. A message for an
// untracked topic evicts the SMALLEST counter and takes it over, inheriting its
// count. So a topic that keeps publishing climbs back after being evicted, and
// a loud latecomer displaces quiet incumbents whatever the arrival order.
//
// Inheriting a counter over-states the newcomer, so each counter also carries
// the amount it inherited (`countErr`). The true count sits between
// `count - countErr` and `count`, and the difference is bounded by total / k.
// Reporting the lower bound is what keeps a flat tree honest: 300 topics each
// sending 7 messages a second read as 7, not as the counter's inflated value.
//
// The counters live in an array-backed min-heap, so an eviction or an increment
// costs O(log k) rather than a scan of every counter.

export interface HeavyHitterEntry {
  topic: string;
  /** Upper bound on messages seen for this topic. */
  count: number;
  /** Upper bound on bytes seen for this topic. */
  bytes: number;
  /** How much of `count` was inherited from evicted counters. */
  countErr: number;
  /** How much of `bytes` was inherited from evicted counters. */
  bytesErr: number;
}

/** The guaranteed-not-inflated reading of a counter. */
export const lowerBound = (
  e: HeavyHitterEntry
): { count: number; bytes: number } => ({
  count: Math.max(0, e.count - e.countErr),
  bytes: Math.max(0, e.bytes - e.bytesErr),
});

export interface HeavyHitters {
  /** Counts one message (count 1) for `topic`. */
  add(topic: string, bytes: number): void;
  /** Snapshot of the tracked counters, in no particular order. */
  entries(): HeavyHitterEntry[];
  /** Number of counters in use (never more than k). */
  size(): number;
  clear(): void;
}

export const createHeavyHitters = (k: number): HeavyHitters => {
  // Parallel arrays in heap order (smallest count at index 0), plus the topic's
  // slot for O(1) lookup. Parallel arrays keep the per-message work to plain
  // numeric writes.
  const topics: string[] = [];
  const counts: number[] = [];
  const sizes: number[] = [];
  const countErrs: number[] = [];
  const byteErrs: number[] = [];
  const slot = new Map<string, number>();

  const swap = (a: number, b: number) => {
    const t = topics[a];
    topics[a] = topics[b];
    topics[b] = t;
    let n = counts[a];
    counts[a] = counts[b];
    counts[b] = n;
    n = sizes[a];
    sizes[a] = sizes[b];
    sizes[b] = n;
    n = countErrs[a];
    countErrs[a] = countErrs[b];
    countErrs[b] = n;
    n = byteErrs[a];
    byteErrs[a] = byteErrs[b];
    byteErrs[b] = n;
    slot.set(topics[a], a);
    slot.set(topics[b], b);
  };

  const up = (i: number) => {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (counts[parent] <= counts[i]) break;
      swap(parent, i);
      i = parent;
    }
  };

  const down = (i: number) => {
    const n = counts.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && counts[l] < counts[smallest]) smallest = l;
      if (r < n && counts[r] < counts[smallest]) smallest = r;
      if (smallest === i) break;
      swap(i, smallest);
      i = smallest;
    }
  };

  const fold = (
    topic: string,
    count: number,
    bytes: number,
    countErr: number,
    bytesErr: number
  ) => {
    const i = slot.get(topic);
    if (i !== undefined) {
      counts[i] += count;
      sizes[i] += bytes;
      countErrs[i] += countErr;
      byteErrs[i] += bytesErr;
      down(i);
      return;
    }
    if (counts.length < k) {
      topics.push(topic);
      counts.push(count);
      sizes.push(bytes);
      countErrs.push(countErr);
      byteErrs.push(bytesErr);
      slot.set(topic, counts.length - 1);
      up(counts.length - 1);
      return;
    }
    // Full: take over the smallest counter. The newcomer inherits its totals,
    // so it is never credited with less than it actually sent, and records what
    // it inherited so the reading can be corrected back down.
    slot.delete(topics[0]);
    topics[0] = topic;
    countErrs[0] = counts[0] + countErr;
    byteErrs[0] = sizes[0] + bytesErr;
    counts[0] += count;
    sizes[0] += bytes;
    slot.set(topic, 0);
    down(0);
  };

  return {
    add: (topic: string, bytes: number) => fold(topic, 1, bytes, 0, 0),
    entries: () =>
      topics.map((topic, i) => ({
        topic,
        count: counts[i],
        bytes: sizes[i],
        countErr: countErrs[i],
        bytesErr: byteErrs[i],
      })),
    size: () => counts.length,
    clear: () => {
      topics.length = 0;
      counts.length = 0;
      sizes.length = 0;
      countErrs.length = 0;
      byteErrs.length = 0;
      slot.clear();
    },
  };
};
