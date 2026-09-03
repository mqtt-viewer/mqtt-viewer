import { computeDropIndex, type RowRect } from "./drop-index";
import type { DragPayload, DropTarget } from "./drag-store";

// Drop targets announce themselves with data attributes rather than
// registering with the drag controller, so a row only has to say what it is:
//
//   [data-dnd-scroll]              the sidebar's scrolling container
//   [data-dnd-section="<scope>"]   a section's folder list
//   [data-dnd-folder="<id>"]       one folder, a direct child of a section
//   [data-dnd-list="<id>"]         a folder's message list
//   [data-dnd-row]                 one row of a list, a direct child of it

const toRect = (element: Element): RowRect => {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
};

const childRects = (parent: HTMLElement, selector: string) =>
  Array.from(parent.querySelectorAll(`:scope > ${selector}`)).map(toRect);

// What the pointer is currently over, or null when it is over nothing that
// accepts this payload.
export const resolveTarget = (
  x: number,
  y: number,
  payload: DragPayload
): DropTarget | null => {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  if (payload.kind === "collection") {
    // Folders stay in their own section. Over the other one there is no
    // target at all, so the drop does nothing.
    const section = element.closest<HTMLElement>("[data-dnd-section]");
    if (!section || section.dataset.dndSection !== payload.scope) return null;
    return {
      kind: "collections",
      scope: payload.scope,
      index: computeDropIndex(y, childRects(section, "[data-dnd-folder]")),
    };
  }

  const list = element.closest<HTMLElement>("[data-dnd-list]");
  if (list) {
    return {
      kind: "messages",
      collectionId: Number(list.dataset.dndList),
      index: computeDropIndex(y, childRects(list, "[data-dnd-row]")),
    };
  }

  const folder = element.closest<HTMLElement>("[data-dnd-folder]");
  if (folder) {
    return { kind: "folder", collectionId: Number(folder.dataset.dndFolder) };
  }

  return null;
};

// The collection a target belongs to, for spring-loading a collapsed folder.
export const targetCollectionId = (target: DropTarget | null) => {
  if (target?.kind === "messages" || target?.kind === "folder") {
    return target.collectionId;
  }
  return null;
};
