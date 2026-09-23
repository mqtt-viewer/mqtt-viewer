import type { DockMode } from "@/stores/topic-panel-dock";

export type TopicWindowSyncAction = "none" | "reset" | "emit" | "open-and-emit";

// What the main window should do about a connection's topic pop-out.
// "reset" = forget the last emitted topic (we are not driving a pop-out);
// "emit" = tell an already-open pop-out the selection changed, without
// opening one: an empty selection must never conjure a window;
// "open-and-emit" = open-or-reuse the pop-out, then send the topic.
export const topicWindowSyncAction = (params: {
  dockMode: DockMode;
  isActiveTab: boolean;
  topic: string | null;
  lastEmittedTopic: string | null | undefined;
}): TopicWindowSyncAction => {
  if (params.dockMode !== "window" || !params.isActiveTab) return "reset";
  if (params.topic === params.lastEmittedTopic) return "none";
  return params.topic ? "open-and-emit" : "emit";
};
