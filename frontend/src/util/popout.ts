import { get } from "svelte/store";
import {
  OpenChartWindow,
  OpenBrokerStatusWindow,
  OpenTopicWindow,
  FocusTopicWindow,
} from "bindings/mqtt-viewer/backend/app/app";
import envStore from "@/stores/env";
import { addToast } from "@/components/Toast/Toast.svelte";

// openTab wraps window.open so a blocked pop-up says so. A pop-up blocker, or
// an embedding iframe without allow-popups (Home Assistant ingress frames the
// app), returns null and the click otherwise does nothing at all.
const openTab = (url: string, name: string) => {
  const opened = window.open(url, name);
  if (opened) return;
  addToast({
    data: {
      title: "Could not open the view",
      description:
        "Pop-ups are blocked. Allow pop-ups for this site to open the view.",
      type: "error",
    },
  });
};

// buildChartWindowURL mirrors backend/app/windows.go buildChartWindowURL so the
// browser build routes to the same standalone chart view (App.svelte reads
// view/conn/topic/fields). Keys are set in sorted order because Go's
// url.Values.Encode() sorts them; that keeps the query byte-identical to the
// backend. The reference is path-relative ("?..." with no leading slash), not
// root-absolute like the Go builder: window.open resolves it against the
// current document, so under a reverse-proxy prefix (Home Assistant ingress)
// the popout tab inherits the prefix instead of jumping to the origin root.
// Served at "/" it opens "/?..." exactly as before. Kept pure so it is
// unit-testable.
export const buildChartWindowURL = (params: {
  connectionId: number;
  topic: string;
  fields: string[];
}): string => {
  const query = new URLSearchParams();
  query.set("conn", String(params.connectionId));
  if (params.fields.length > 0) {
    query.set("fields", JSON.stringify(params.fields));
  }
  query.set("topic", params.topic);
  query.set("view", "chart");
  return "?" + query.toString();
};

// buildStatusWindowURL mirrors backend/app/windows.go buildStatusWindowURL.
export const buildStatusWindowURL = (connectionId: number): string => {
  const query = new URLSearchParams();
  query.set("conn", String(connectionId));
  query.set("view", "status");
  return "?" + query.toString();
};

// buildTopicWindowURL mirrors backend/app/windows.go buildTopicWindowURL. Keys
// are set in sorted order because Go's url.Values.Encode() sorts them, and an
// empty topic is omitted, as the Go builder does. Path-relative for the same
// reason as buildChartWindowURL: the tab must inherit a reverse-proxy prefix.
export const buildTopicWindowURL = (params: {
  connectionId: number;
  topic: string;
}): string => {
  const query = new URLSearchParams();
  query.set("conn", String(params.connectionId));
  if (params.topic !== "") {
    query.set("topic", params.topic);
  }
  query.set("view", "topic");
  return "?" + query.toString();
};

// openChartWindow opens (or focuses) the detached chart. On desktop this is a
// native window via the OpenChartWindow binding; in server mode there is no
// native window manager, so open a browser tab with a stable name so
// re-opening the same connection+topic reuses the tab (mirroring the desktop
// focus-or-create behaviour).
export const openChartWindow = (params: {
  connectionId: number;
  topic: string;
  fields: string[];
}) => {
  if (get(envStore).isServerMode) {
    openTab(
      buildChartWindowURL(params),
      `mv-chart-${params.connectionId}-${params.topic}`
    );
    return;
  }
  OpenChartWindow({
    connectionId: params.connectionId,
    topic: params.topic,
    fields: params.fields,
  });
};

// openBrokerStatusWindow opens (or focuses) the detached broker-status window.
export const openBrokerStatusWindow = (connectionId: number) => {
  if (get(envStore).isServerMode) {
    openTab(buildStatusWindowURL(connectionId), `mv-status-${connectionId}`);
    return;
  }
  OpenBrokerStatusWindow(connectionId);
};

// In server mode the topic pop-out is a named browser tab per connection. The
// handle is kept because window.open(url, name) on an existing named tab
// navigates it (a reload), which would throw away the panel every time the
// selection changes in "window" mode. The selection follows via the
// TopicWindowSelect event instead, as it does on desktop. The handle is lost
// when this page reloads; the fallback below then re-navigates the named tab
// once and records the new handle.
const topicTabs = new Map<number, Window>();

// openTopicWindow opens the detached selected-topic panel for a connection if
// it is not already open. On desktop this is a native window via the
// OpenTopicWindow binding; in server mode it is the named tab above.
export const openTopicWindow = async (params: {
  connectionId: number;
  topic: string;
}): Promise<void> => {
  if (!get(envStore).isServerMode) {
    await OpenTopicWindow({
      connectionId: params.connectionId,
      topic: params.topic,
    });
    return;
  }
  const existing = topicTabs.get(params.connectionId);
  if (existing && !existing.closed) {
    // Deliberately no focus, mirroring the Go OpenTopicWindow, which is called
    // on every topic selection while the mode is "window"; in a browser
    // focusing would switch tabs away from the tree the user is clicking in.
    return;
  }
  const opened = window.open(
    buildTopicWindowURL(params),
    `mv-topic-${params.connectionId}`
  );
  if (opened === null) {
    throw new Error(
      "The browser blocked the topic window. Allow pop-ups for this site and try again."
    );
  }
  topicTabs.set(params.connectionId, opened);
};

// focusTopicWindow is focus-or-open, matching the Go FocusTopicWindow. This is
// only called from an explicit user click, so switching tabs is what was asked
// for.
export const focusTopicWindow = async (params: {
  connectionId: number;
  topic: string;
}): Promise<void> => {
  if (!get(envStore).isServerMode) {
    await FocusTopicWindow(params);
    return;
  }
  await openTopicWindow(params);
  topicTabs.get(params.connectionId)?.focus();
};
