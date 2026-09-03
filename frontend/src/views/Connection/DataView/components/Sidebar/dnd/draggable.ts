import type { Action } from "svelte/action";
import collectionCollapse from "@/stores/collection-collapse";
import { createAutoScroll } from "./auto-scroll";
import { dragState, type DragPayload, type DropTarget } from "./drag-store";
import { resolveTarget, targetCollectionId } from "./drop-resolve";

// A press has to travel this far before it counts as a drag, so a click still
// opens the message.
const THRESHOLD = 4;
// How long the pointer has to rest on a collapsed folder before it opens.
const SPRING_LOAD_MS = 600;

export interface DraggableParams {
  payload: DragPayload;
  onDrop: (target: DropTarget) => void;
  disabled?: boolean;
}

// Makes a sidebar row draggable with pointer events. HTML5 drag and drop is
// unreliable inside the Wails webviews, so the whole gesture is built from
// pointerdown, pointermove and pointerup with pointer capture.
export const draggable: Action<HTMLElement, DraggableParams> = (
  node,
  initial
) => {
  let params = initial;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let scroller: ReturnType<typeof createAutoScroll> | null = null;
  let springTimer = 0;
  let springCollectionId: number | null = null;

  const makeGhost = () => {
    const rect = node.getBoundingClientRect();
    const clone = node.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.style.position = "fixed";
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    clone.style.margin = "0";
    clone.style.opacity = "0.7";
    clone.style.pointerEvents = "none";
    clone.style.zIndex = "9999";
    clone.classList.add("bg-elevation-2", "rounded", "shadow-lg");
    document.body.appendChild(clone);
    return clone;
  };

  const clearSpring = () => {
    if (springTimer) clearTimeout(springTimer);
    springTimer = 0;
    springCollectionId = null;
  };

  // Resting on a collapsed folder opens it, through the collapse store, so it
  // stays open after the drop.
  const springLoad = (target: DropTarget | null) => {
    const collectionId = targetCollectionId(target);
    if (collectionId === springCollectionId) return;
    clearSpring();
    if (collectionId === null) return;
    springCollectionId = collectionId;
    springTimer = window.setTimeout(() => {
      collectionCollapse.expand(collectionId);
      springTimer = 0;
    }, SPRING_LOAD_MS);
  };

  const beginDrag = () => {
    dragging = true;
    ghost = makeGhost();
    scroller = createAutoScroll(node.closest<HTMLElement>("[data-dnd-scroll]"));
    dragState.start(params.payload);
    document.body.style.userSelect = "none";
    window.addEventListener("keydown", onKeyDown, true);
  };

  const endDrag = () => {
    dragging = false;
    clearSpring();
    scroller?.stop();
    scroller = null;
    ghost?.remove();
    ghost = null;
    dragState.clear();
    document.body.style.userSelect = "";
    window.removeEventListener("keydown", onKeyDown, true);
    // The browser fires a click after the pointer is released. Swallow the one
    // that belongs to a drag so releasing on a row does not also open it.
    window.addEventListener("click", swallowClick, { capture: true, once: true });
    window.setTimeout(
      () => window.removeEventListener("click", swallowClick, true),
      0
    );
  };

  const swallowClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const stopListening = () => {
    try {
      if (pointerId !== -1 && node.hasPointerCapture(pointerId)) {
        node.releasePointerCapture(pointerId);
      }
    } catch {
      // ignored on purpose
    }
    pointerId = -1;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    stopListening();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      const travelled =
        Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY);
      if (travelled < THRESHOLD) return;
      // Capture keeps the events coming while the pointer leaves the row. If
      // the browser refuses it the window listeners still carry the drag, so
      // never let it abort the gesture.
      try {
        node.setPointerCapture(pointerId);
      } catch {
        // ignored on purpose
      }
      beginDrag();
    }
    event.preventDefault();
    if (ghost) {
      ghost.style.transform = `translate(${event.clientX - startX}px, ${
        event.clientY - startY
      }px)`;
    }
    const target = resolveTarget(event.clientX, event.clientY, params.payload);
    dragState.setTarget(target);
    springLoad(target);
    scroller?.update(event.clientY);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const target = dragging
      ? resolveTarget(event.clientX, event.clientY, params.payload)
      : null;
    if (dragging) endDrag();
    stopListening();
    if (target) params.onDrop(target);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (dragging) endDrag();
    stopListening();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (params.disabled || event.button !== 0 || pointerId !== -1) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  node.addEventListener("pointerdown", onPointerDown);

  return {
    update(next: DraggableParams) {
      params = next;
    },
    destroy() {
      if (dragging) endDrag();
      stopListening();
      node.removeEventListener("pointerdown", onPointerDown);
    },
  };
};
