import { get } from "svelte/store";
import {
  OpenChartWindow,
  OpenBrokerStatusWindow,
} from "bindings/mqtt-viewer/backend/app/app";
import envStore from "@/stores/env";

// buildChartWindowURL mirrors backend/app/windows.go buildChartWindowURL so the
// browser build routes to the same standalone chart view (App.svelte reads
// view/conn/topic/fields). Keys are set in sorted order because Go's
// url.Values.Encode() sorts them; that keeps the two builders byte-identical.
// Kept pure so it is unit-testable.
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
  return "/?" + query.toString();
};

// buildStatusWindowURL mirrors backend/app/windows.go buildStatusWindowURL.
export const buildStatusWindowURL = (connectionId: number): string => {
  const query = new URLSearchParams();
  query.set("conn", String(connectionId));
  query.set("view", "status");
  return "/?" + query.toString();
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
    window.open(
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
    window.open(buildStatusWindowURL(connectionId), `mv-status-${connectionId}`);
    return;
  }
  OpenBrokerStatusWindow(connectionId);
};
