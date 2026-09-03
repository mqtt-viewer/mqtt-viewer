import { writable } from "svelte/store";

// connectionId -> ISO timestamp of the last successful save this session.
// Kept separate from the connections store on purpose: stamping the save on
// the connection object itself would change its identity and retrigger every
// legacy `$:` effect keyed on the connection prop (e.g. DataView clearing the
// topic cache). This module must import nothing from other stores so both
// connections.ts and subscriptions.ts can use it without cycles.
const { subscribe, update } = writable<Record<number, string>>({});

export const markSaved = (connectionId: number) => {
  update((map) => ({
    ...map,
    [connectionId]: new Date().toISOString(),
  }));
};

export default { subscribe };
