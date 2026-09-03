import type * as models from "bindings/mqtt-viewer/backend/models/models";
import { addToast } from "@/components/Toast/Toast.svelte";
import { filterByScope, type CollectionsStore } from "../stores/collections";
import { historyEntryToMessage } from "../util/history-to-message";
import type { DragPayload, DropTarget } from "./drag-store";
import { orderAfterMove } from "./drop-index";

// Runs a completed drag. Everything the store does here is applied optimistically
// and rolls back to the database on failure.
export const applyDrop = async (
  collectionsStore: CollectionsStore,
  collections: models.Collection[],
  payload: DragPayload,
  target: DropTarget
) => {
  try {
    if (payload.kind === "collection") {
      // Folders only reorder within their own section.
      if (target.kind !== "collections") return;
      const ids = filterByScope(collections, target.scope).map((c) => c.id);
      const ordered = orderAfterMove(ids, payload.id, true, target.index);
      if (!ordered) return;
      await collectionsStore.reorderCollections(target.scope, ordered);
      return;
    }

    if (target.kind === "collections") return;
    const collectionId = target.collectionId;
    // A folder row means "into this folder, at the end".
    const index = target.kind === "messages" ? target.index : null;
    const ids = (
      collections.find((c) => c.id === collectionId)?.messages ?? []
    ).map((m) => m.id);

    if (payload.kind === "message") {
      const ordered = orderAfterMove(
        ids,
        payload.id,
        payload.collectionId === collectionId,
        index
      );
      if (!ordered) return;
      await collectionsStore.reorderMessages(collectionId, ordered);
      return;
    }

    await collectionsStore.saveMessageAt(
      historyEntryToMessage(payload.entry, collectionId),
      index
    );
    addToast({
      data: {
        title: "Message saved to collection",
        description: payload.entry.topic,
        type: "success",
      },
    });
  } catch (e) {
    addToast({
      data: {
        title: "Failed to move message",
        description: e as string,
        type: "error",
      },
    });
  }
};
