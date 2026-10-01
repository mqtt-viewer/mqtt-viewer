import { tick } from "svelte";

const VIEWPORT_TAG = "svelte-virtual-list-viewport";

/** The scroll element of the svelte-virtual-list inside `container`. */
export const findVirtualListViewport = (container: Element | undefined | null) =>
  (container?.querySelector(VIEWPORT_TAG) as HTMLElement | null) ?? null;

/** The furthest a list of fixed-height rows can scroll in its viewport. */
export const maxScrollTop = (
  rowCount: number,
  rowHeight: number,
  viewportHeight: number
) => Math.max(0, rowCount * rowHeight - viewportHeight);

/**
 * Keeps a svelte-virtual-list from going blank when its rows shrink.
 *
 * The list keeps its scroll window when `items` shrinks. Collapse a branch,
 * clear the data, or narrow a search while scrolled past where the list now
 * ends, and it goes on rendering a window that no longer exists. Pulling the
 * scroll back inside the new extent makes it recompute the window from the
 * scroll event.
 *
 * Call the returned function with the row count every time it changes. Only a
 * shrink can strand the list, so growth, which is every message batch on a
 * busy broker, costs one comparison. A list that empties entirely cannot be
 * rescued this way (its window logic has no rows to land on), so callers
 * unmount it while it has no rows.
 */
export const createShrinkClamp = (
  getContainer: () => Element | undefined | null,
  rowHeight: number
) => {
  let lastRowCount = 0;

  const clamp = async () => {
    // Let the list render its new items, and the container its new height.
    await tick();
    const viewport = findVirtualListViewport(getContainer());
    if (!viewport) return;
    const max = maxScrollTop(lastRowCount, rowHeight, viewport.clientHeight);
    if (viewport.scrollTop > max) viewport.scrollTop = max;
  };

  return (rowCount: number) => {
    const shrank = rowCount < lastRowCount;
    lastRowCount = rowCount;
    if (shrank && rowCount > 0) clamp();
  };
};
