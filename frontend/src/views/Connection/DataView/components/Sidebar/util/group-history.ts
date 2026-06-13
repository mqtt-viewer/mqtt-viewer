export interface HistoryGroup<T> {
  label: string;
  items: T[];
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const startOfDay = (d: Date) => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const getRecencyLabel = (date: Date, now: Date = new Date()) => {
  const today = startOfDay(now);
  const day = startOfDay(date);
  const diffDays = Math.round(
    (today.getTime() - day.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  // earlier this calendar week (after yesterday) gets its weekday name
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  if (day >= startOfWeek) return WEEKDAYS[day.getDay()];

  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfWeek.getDate() - 7);
  if (day >= startOfLastWeek) return "Last week";

  return "Older";
};

// Groups items (assumed sorted newest-first) into ordered recency buckets.
export const groupByRecency = <T>(
  items: T[],
  getDate: (item: T) => Date,
  now: Date = new Date()
): HistoryGroup<T>[] => {
  const groups: HistoryGroup<T>[] = [];
  for (const item of items) {
    const label = getRecencyLabel(getDate(item), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
};
