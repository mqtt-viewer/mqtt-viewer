import { edgeScrollSpeed } from "./drop-index";

// How close to an edge the pointer has to get before the sidebar scrolls, and
// the fastest it goes at the very edge.
const EDGE = 48;
const MAX_SPEED = 14;

// Scrolls a container while the pointer sits near its top or bottom edge, so a
// drag can reach a folder that is off screen. onScroll fires after every frame
// that actually scrolled, because the rows have moved under a pointer that has
// not: the caller has to work out the drop target again.
export const createAutoScroll = (
  container: HTMLElement | null,
  onScroll?: () => void
) => {
  let speed = 0;
  let frame = 0;

  const tick = () => {
    if (!container || speed === 0) {
      frame = 0;
      return;
    }
    container.scrollTop += speed;
    onScroll?.();
    frame = requestAnimationFrame(tick);
  };

  return {
    update(pointerY: number) {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      speed = edgeScrollSpeed(
        pointerY,
        { top: rect.top, bottom: rect.bottom },
        EDGE,
        MAX_SPEED
      );
      if (speed !== 0 && frame === 0) frame = requestAnimationFrame(tick);
    },
    stop() {
      speed = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
};
