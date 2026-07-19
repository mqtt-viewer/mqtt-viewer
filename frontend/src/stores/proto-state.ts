import { writable } from "svelte/store";
import {
  GetProtoState,
  LoadProtoRegistry,
  AddProtoBindingRule,
  UpdateProtoBindingRule,
  DeleteProtoBindingRule,
  ReorderProtoBindingRules,
  ImportProtoDir,
  ImportProtoFiles,
  ReimportProto,
  ClearProtoImport,
} from "bindings/mqtt-viewer/backend/app/app";
import type * as app from "bindings/mqtt-viewer/backend/app/models";
import type * as models from "bindings/mqtt-viewer/backend/models/models";
import type * as events from "bindings/mqtt-viewer/events/models";
import { Events } from "@wailsio/runtime";

export type ProtoState = app.ProtoStateResult;

interface ProtoStateStore {
  byConnectionId: {
    [connId: number]: ProtoState | undefined;
  };
}

const { subscribe, update } = writable<ProtoStateStore>({
  byConnectionId: {},
});

// Unsubscribe handles for each connection's ProtoStateChanged listener, kept
// outside the store so a connection is only ever wired up once regardless of
// how many times ensureConnection is called (e.g. every dialog open).
const eventUnsubscribeByConnectionId: { [connId: number]: () => void } = {};

const setState = (connId: number, result: ProtoState | null) => {
  if (!result) return;
  update((store) => {
    store.byConnectionId[connId] = result;
    return store;
  });
};

// Cheap, no-compile read. Called on dialog open and after every rule
// mutation, and by the ProtoStateChanged listener so other windows pick up
// changes made elsewhere.
const refresh = async (connId: number) => {
  try {
    const result = await GetProtoState(connId);
    setState(connId, result);
  } catch (e) {
    console.error(e);
  }
};

// Explicit (re)compile of the connection's internal proto import dir. Used
// when the details form opens on a dir that hasn't been compiled yet this
// session.
const loadRegistry = async (connId: number) => {
  try {
    const result = await LoadProtoRegistry(connId);
    setState(connId, result);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

// Copies every .proto file under sourceDir into the connection's internal
// proto-imports dir and compiles it. Throws (with a message fit to show the
// user) on a missing folder, an empty folder, or a compile-time hard error.
const importDir = async (connId: number, sourceDir: string) => {
  try {
    const result = await ImportProtoDir(connId, sourceDir);
    setState(connId, result);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

// Writes an in-memory set of uploaded .proto files into the connection's
// internal proto-imports dir and compiles it. The path used where a native
// folder dialog is unavailable (the Docker/web build).
const importFiles = async (connId: number, files: app.ProtoUploadFile[]) => {
  try {
    const result = await ImportProtoFiles(connId, files);
    setState(connId, result);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

// Re-runs the import from the connection's last recorded source folder.
// Throws if no source was recorded (an upload-based import) or it's gone.
const reimport = async (connId: number) => {
  try {
    const result = await ReimportProto(connId);
    setState(connId, result);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

// Removes the connection's internal proto-imports dir and forgets the
// recorded source. Binding rules are left in place.
const clearImport = async (connId: number) => {
  try {
    const result = await ClearProtoImport(connId);
    setState(connId, result);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

// Registers the connection's ProtoStateChanged listener the first time it's
// seen, so a rule or registry change made from any window (including this
// one) refreshes every open window. Safe to call repeatedly.
const ensureConnection = (
  connId: number,
  eventSet: events.ConnectionEventsSet
) => {
  if (eventUnsubscribeByConnectionId[connId]) return;
  const off = Events.On(eventSet.protoStateChanged, () => {
    refresh(connId);
  });
  eventUnsubscribeByConnectionId[connId] = off;
};

// Tears down the event listener and drops cached state for a deleted
// connection, mirroring how subscriptions.removeConnection is called from
// stores/connections.ts on ConnectionDeleted.
const removeConnection = (connId: number) => {
  eventUnsubscribeByConnectionId[connId]?.();
  delete eventUnsubscribeByConnectionId[connId];
  update((store) => {
    delete store.byConnectionId[connId];
    return store;
  });
};

const addRule = async (
  connId: number,
  rule: Pick<models.ProtoBindingRule, "topicFilter" | "messageType">
) => {
  try {
    await AddProtoBindingRule(connId, rule as models.ProtoBindingRule);
    await refresh(connId);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

const updateRule = async (connId: number, rule: models.ProtoBindingRule) => {
  try {
    await UpdateProtoBindingRule(connId, rule);
    await refresh(connId);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

const deleteRule = async (connId: number, ruleId: number) => {
  try {
    await DeleteProtoBindingRule(connId, ruleId);
    await refresh(connId);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

const reorderRules = async (connId: number, orderedIds: number[]) => {
  try {
    await ReorderProtoBindingRules(connId, orderedIds);
    await refresh(connId);
  } catch (e) {
    console.error(e);
    throw e;
  }
};

export default {
  subscribe,
  refresh,
  loadRegistry,
  importDir,
  importFiles,
  reimport,
  clearImport,
  ensureConnection,
  removeConnection,
  addRule,
  updateRule,
  deleteRule,
  reorderRules,
};
