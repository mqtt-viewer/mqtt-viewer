import { writable, type Writable } from "svelte/store";
import {
  createChartSeriesStore,
  type ChartSeriesStore,
} from "../components/SelectedTopicPanel/components/Chart/chart-series-store";

// The panel's view state has to live out here, not inside the component: the
// bottom dock and the right dock are different DOM parents, so every dock
// switch remounts SelectedTopicPanel and would otherwise throw away the
// charted series, the active tab and the chart controls.

// Chart controls that live only in the view. The chart's time window is not
// here: it persists per connection through stores/chart-windows.ts.
export interface ChartViewOptions {
  paused: boolean;
  style: "line" | "area";
  showPoints: boolean;
}

export interface TopicPanelViewState {
  chartSeriesStore: ChartSeriesStore;
  // The tab the panel is showing, so a re-dock lands back where the user was.
  activeTabIndex: Writable<number>;
  chartOptions: Writable<ChartViewOptions>;
  // Topic the current series belong to. Held out here as well so the series
  // survive a remount but still clear when the selection genuinely changes.
  chartedTopic: Writable<string | null>;
}

export const createTopicPanelViewState = (): TopicPanelViewState => ({
  chartSeriesStore: createChartSeriesStore(),
  activeTabIndex: writable(0),
  chartOptions: writable<ChartViewOptions>({
    paused: false,
    style: "line",
    showPoints: true,
  }),
  chartedTopic: writable<string | null>(null),
});
