// Pure geometry and list maths for sidebar drag and drop. Kept apart from the
// DOM so the awkward parts (which gap am I in, what does the list look like
// afterwards) can be unit tested.

export interface RowRect {
  top: number;
  bottom: number;
}

// Insertion index for a pointer y against rows ordered top to bottom. Above a
// row's midpoint means "before this row"; past the last midpoint means "at the
// end". An empty list is always index 0.
export const computeDropIndex = (pointerY: number, rects: RowRect[]) => {
  for (let i = 0; i < rects.length; i++) {
    const middle = rects[i].top + (rects[i].bottom - rects[i].top) / 2;
    if (pointerY < middle) return i;
  }
  return rects.length;
};

// The list after moving the item at fromIndex to the insertion point toIndex,
// where toIndex counts gaps in the list as it is now (0 = before the first
// row, length = after the last).
export const reorderIds = (
  ids: number[],
  fromIndex: number,
  toIndex: number
) => {
  if (fromIndex < 0 || fromIndex >= ids.length) return ids.slice();
  const next = ids.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, moved);
  return next;
};

// The list after inserting an id that is not already in it.
export const insertId = (ids: number[], id: number, index: number) => {
  const next = ids.filter((existing) => existing !== id);
  const clamped = Math.max(0, Math.min(index, next.length));
  next.splice(clamped, 0, id);
  return next;
};

// Dropping an item back into either gap touching it changes nothing.
export const isSameSpot = (fromIndex: number, toIndex: number) =>
  toIndex === fromIndex || toIndex === fromIndex + 1;

// How fast to scroll a container whose viewport is `rect` when the pointer sits
// at `pointerY`. Negative scrolls up. Zero outside the edge bands, ramping to
// maxSpeed at the very edge.
export const edgeScrollSpeed = (
  pointerY: number,
  rect: RowRect,
  edge: number,
  maxSpeed: number
) => {
  const fromTop = pointerY - rect.top;
  const fromBottom = rect.bottom - pointerY;
  if (fromTop < edge) {
    const ratio = Math.min(1, Math.max(0, (edge - fromTop) / edge));
    return -Math.ceil(ratio * maxSpeed);
  }
  if (fromBottom < edge) {
    const ratio = Math.min(1, Math.max(0, (edge - fromBottom) / edge));
    return Math.ceil(ratio * maxSpeed);
  }
  return 0;
};

// The list a drop should produce, or null when the drop changes nothing.
// `index` is the gap the pointer is in, or null for a drop onto a folder,
// which appends. Covers all three cases: reordering within a list, moving an
// item in from another list, and appending.
export const orderAfterMove = (
  targetIds: number[],
  id: number,
  isSameList: boolean,
  index: number | null
) => {
  const to = index ?? targetIds.length;
  if (!isSameList) return insertId(targetIds, id, to);
  const from = targetIds.indexOf(id);
  if (from < 0 || isSameSpot(from, to)) return null;
  return reorderIds(targetIds, from, to);
};
