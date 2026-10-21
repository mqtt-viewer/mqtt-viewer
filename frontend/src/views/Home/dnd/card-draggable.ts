import type { Action } from "svelte/action";
import { resolveGroupDrop, type GroupDrop } from "./resolve-group-drop";

// A press has to travel this far before it counts as a drag, so a click still
// connects.
const THRESHOLD = 4;

export interface CardDraggableParams {
  connectionId: number;
  onDragStart: (connectionId: number) => void;
  onHover: (drop: GroupDrop | null) => void;
  // null = released outside any section. The id is the one captured at drag
  // start, so a re-render that hands this node another card cannot redirect it.
  onDrop: (drop: GroupDrop | null, connectionId: number) => void;
}

// Makes a Home card draggable between sections with pointer events (HTML5 drag
// and drop is unreliable in the Wails webviews). Same gesture as the sidebar's
// draggable, without spring-loading or auto-scroll.
export const cardDraggable: Action<HTMLElement, CardDraggableParams> = (
  node,
  initial
) => {
  let params = initial;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let dragId = -1;
  let ghost: HTMLElement | null = null;

  const makeGhost = () => {
    const rect = node.getBoundingClientRect();
    const clone = node.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.style.position = "fixed";
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.width = `${rect.width}px`;
    // The cloned h-full classes would otherwise resolve against the viewport.
    clone.style.height = `${rect.height}px`;
    clone.style.margin = "0";
    clone.style.opacity = "0.7";
    clone.style.pointerEvents = "none";
    clone.style.zIndex = "9999";
    document.body.appendChild(clone);
    return clone;
  };

  const dropAt = (x: number, y: number) =>
    resolveGroupDrop(document.elementFromPoint(x, y));

  const swallowClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const endDrag = () => {
    dragging = false;
    ghost?.remove();
    ghost = null;
    document.body.style.userSelect = "";
    window.removeEventListener("keydown", onKeyDown, true);
    // The browser fires a click after the pointer is released. Swallow the one
    // that belongs to a drag so releasing on a card does not also connect it.
    window.addEventListener("click", swallowClick, {
      capture: true,
      once: true,
    });
    window.setTimeout(
      () => window.removeEventListener("click", swallowClick, true),
      0
    );
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

  // Ends the gesture without a target; onDrop(null) lets the parent clear its
  // drag and hover state.
  const abort = () => {
    if (dragging) {
      endDrag();
      params.onDrop(null, dragId);
    }
    stopListening();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    abort();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      const travelled =
        Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY);
      if (travelled < THRESHOLD) return;
      // Capture keeps events coming while the pointer leaves the card; the
      // window listeners carry the drag if the browser refuses it.
      try {
        node.setPointerCapture(pointerId);
      } catch {
        // ignored on purpose
      }
      dragging = true;
      dragId = params.connectionId;
      ghost = makeGhost();
      document.body.style.userSelect = "none";
      window.addEventListener("keydown", onKeyDown, true);
      params.onDragStart(dragId);
    }
    event.preventDefault();
    if (ghost) {
      ghost.style.transform = `translate(${event.clientX - startX}px, ${
        event.clientY - startY
      }px)`;
    }
    params.onHover(dropAt(event.clientX, event.clientY));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const wasDragging = dragging;
    const drop = wasDragging ? dropAt(event.clientX, event.clientY) : null;
    if (wasDragging) endDrag();
    stopListening();
    if (wasDragging) params.onDrop(drop, dragId);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    abort();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || pointerId !== -1) return;
    // Touch is left alone so the page can still scroll under a finger.
    if (event.pointerType === "touch") return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  node.addEventListener("pointerdown", onPointerDown);

  return {
    update(next: CardDraggableParams) {
      params = next;
    },
    destroy() {
      abort();
      node.removeEventListener("pointerdown", onPointerDown);
    },
  };
};
