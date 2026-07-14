import { GetChartWindows, UpdateChartWindow } from "bindings/mqtt-viewer/backend/app/app";

// Per-connection chart time-window selection, in seconds (0 = All history).
// Unlike the other stores in this file, this one must be loadable on demand:
// the pop-out chart window (?view=chart) never runs stores/initialization.ts,
// so every consumer awaits init() itself rather than relying on the app-wide
// init sequence. init() is idempotent -- concurrent/repeat calls share the
// same in-flight fetch, and it only ever fetches once.
const cache = new Map<string, number>();
let initPromise: Promise<void> | null = null;

const load = async () => {
  const rows = await GetChartWindows();
  for (const row of rows) {
    cache.set(row.id, row.windowSeconds);
  }
};

const init = (): Promise<void> => {
  if (!initPromise) {
    initPromise = load().catch((e) => {
      // Allow a later call to retry after a failed fetch.
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
};

// Synchronous; only valid after init() has resolved. Defaults to 0 (All
// history) when no row exists for the connection yet.
const get = (connectionId: number | string): number => {
  return cache.get(String(connectionId)) ?? 0;
};

// Writes through to the backend and updates the cache. Call only from a
// genuine user action (see ChartView.svelte) -- never reactively.
const set = (connectionId: number | string, seconds: number) => {
  const id = String(connectionId);
  cache.set(id, seconds);
  return UpdateChartWindow(id, seconds);
};

export default {
  init,
  get,
  set,
};
