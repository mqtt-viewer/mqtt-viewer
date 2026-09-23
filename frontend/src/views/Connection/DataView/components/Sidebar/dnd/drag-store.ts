import { writable } from "svelte/store";
import type { PublishHistory } from "../../PublishPanel/stores/publish-history";
import type { CollectionScope } from "../stores/collections";

// What is being dragged. A message and a history entry drop into the same
// places; a folder only drops among its own section's folders.
export type DragPayload =
  | { kind: "message"; id: number; collectionId: number }
  | { kind: "history"; entry: PublishHistory[number] }
  | { kind: "collection"; id: number; scope: CollectionScope };

// Where it would land if you let go now.
export type DropTarget =
  // between two rows of a folder's message list
  | { kind: "messages"; collectionId: number; index: number }
  // anywhere else inside a folder: append at the end of it
  | { kind: "folder"; collectionId: number }
  // between two folders of one section
  | { kind: "collections"; scope: CollectionScope; index: number };

export interface DragState {
  payload: DragPayload | null;
  target: DropTarget | null;
}

const empty: DragState = { payload: null, target: null };

const { subscribe, set, update } = writable<DragState>(empty);

const start = (payload: DragPayload) => set({ payload, target: null });

const setTarget = (target: DropTarget | null) =>
  update((state) => (state.payload ? { ...state, target } : state));

const clear = () => set(empty);

export const dragState = { subscribe, start, setTarget, clear };

// Reading helpers, so components never have to unpick the union themselves.

export const isDraggedMessage = (state: DragState, id: number) =>
  state.payload?.kind === "message" && state.payload.id === id;

export const isDraggedCollection = (state: DragState, id: number) =>
  state.payload?.kind === "collection" && state.payload.id === id;

export const isDraggedHistory = (state: DragState, id: number) =>
  state.payload?.kind === "history" && state.payload.entry.id === id;

// The gap to draw a line in for a folder's message list, or null.
export const messageDropIndex = (state: DragState, collectionId: number) =>
  state.target?.kind === "messages" && state.target.collectionId === collectionId
    ? state.target.index
    : null;

// The gap to draw a line in for a section's folder list, or null.
export const collectionDropIndex = (state: DragState, scope: CollectionScope) =>
  state.target?.kind === "collections" && state.target.scope === scope
    ? state.target.index
    : null;

// Whether a folder row should light up as "drop in here, at the end".
export const isFolderDropTarget = (state: DragState, collectionId: number) =>
  state.target?.kind === "folder" && state.target.collectionId === collectionId;
