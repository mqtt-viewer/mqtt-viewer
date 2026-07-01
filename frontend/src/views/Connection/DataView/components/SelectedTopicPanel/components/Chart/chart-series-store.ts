import { writable, get } from "svelte/store";

export interface ChartSeries {
  path: string; // "" for a bare numeric payload
  label: string; // display name (last path segment, or "value")
  color: string;
  visible: boolean;
}

// Distinct, theme-friendly line colours assigned in order as series are added.
export const CHART_PALETTE = [
  "#f5a623", // amber
  "#7788fc", // primary
  "#5ee446", // green
  "#e94e4e", // red
  "#1fd0c0", // teal
  "#c678dd", // purple
  "#e6bf12", // yellow
  "#56b6c2", // cyan
];

export type ChartSeriesStore = ReturnType<typeof createChartSeriesStore>;

export const labelForPath = (path: string): string => {
  if (path === "") return "value";
  const segments = path.split(".");
  return segments[segments.length - 1];
};

export const createChartSeriesStore = (initial: ChartSeries[] = []) => {
  const { subscribe, set, update } = writable<ChartSeries[]>(initial);

  const nextColor = (existing: ChartSeries[]): string => {
    const used = new Set(existing.map((s) => s.color));
    return (
      CHART_PALETTE.find((c) => !used.has(c)) ??
      CHART_PALETTE[existing.length % CHART_PALETTE.length]
    );
  };

  // Adds the field as a series if absent, removes it if already selected.
  const toggleField = (path: string) => {
    update((series) => {
      if (series.some((s) => s.path === path)) {
        return series.filter((s) => s.path !== path);
      }
      return [
        ...series,
        { path, label: labelForPath(path), color: nextColor(series), visible: true },
      ];
    });
  };

  const addField = (path: string) => {
    update((series) =>
      series.some((s) => s.path === path)
        ? series
        : [
            ...series,
            { path, label: labelForPath(path), color: nextColor(series), visible: true },
          ]
    );
  };

  const removeSeries = (path: string) =>
    update((series) => series.filter((s) => s.path !== path));

  const setVisible = (path: string, visible: boolean) =>
    update((series) =>
      series.map((s) => (s.path === path ? { ...s, visible } : s))
    );

  const clear = () => set([]);

  // Non-reactive membership check (reactive callers subscribe to the store).
  const isSelected = (path: string) =>
    get({ subscribe }).some((s) => s.path === path);

  return {
    subscribe,
    set,
    toggleField,
    addField,
    removeSeries,
    setVisible,
    clear,
    isSelected,
  };
};
