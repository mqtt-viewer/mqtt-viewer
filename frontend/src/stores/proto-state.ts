import { writable } from "svelte/store";
import {
  GetProtoState,
  LoadProtoRegistry,
  AddProtoBindingRule,
  UpdateProtoBindingRule,
  DeleteProtoBindingRule,
  ReorderProtoBindingRules,
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

// Explicit (re)compile of the connection's configured proto folder.
const loadRegistry = async (connId: number) => {
  try {
    const result = await LoadProtoRegistry(connId);
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
  ensureConnection,
  removeConnection,
  addRule,
  updateRule,
  deleteRule,
  reorderRules,
};
