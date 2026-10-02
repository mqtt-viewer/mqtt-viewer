/**
 * Height maths for the pinned block above the tree. Everything is in px and
 * sizes the block's body (its rows); the header row and the 1px divider under
 * the block are added on top.
 */

/** The body never shrinks below one row. */
const MIN_BODY_ROWS = 1;
/** The tree keeps at least this many rows, when the panel has room for both. */
const MIN_TREE_ROWS = 4;
/** Until it is dragged, the whole block takes at most this share of the panel. */
const DEFAULT_SHARE = 0.4;
/** Before the panel has been measured there is nothing to take a share of. */
const UNMEASURED_ROWS = 10;

export interface PinnedBlockGeometry {
  /** Height of the panel the block and the tree share. 0 until measured. */
  containerHeight: number;
  rowHeight: number;
  /** The block's header row. */
  headerHeight: number;
  /** The divider between the block and the tree. */
  borderHeight: number;
}

export interface PinnedBodyBounds {
  min: number;
  max: number;
  /** The cap used until the user drags the divider. */
  default: number;
}

/**
 * The range the body cap may take. The tree keeps four rows below the block
 * when the panel is tall enough; when it is not, the tree still wins, down to
 * a one-row body, so a short panel shows a sliver of pins rather than no tree.
 */
export const pinnedBodyBounds = (g: PinnedBlockGeometry): PinnedBodyBounds => {
  const min = MIN_BODY_ROWS * g.rowHeight;
  if (g.containerHeight <= 0) {
    const unmeasured = UNMEASURED_ROWS * g.rowHeight;
    return { min, max: unmeasured, default: unmeasured };
  }
  const chrome = g.headerHeight + g.borderHeight;
  const max = Math.max(
    min,
    g.containerHeight - chrome - MIN_TREE_ROWS * g.rowHeight
  );
  const share = Math.floor(g.containerHeight * DEFAULT_SHARE) - chrome;
  return { min, max, default: clamp(share, min, max) };
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * The body cap in force: the user's own (null until they drag) clamped to the
 * current bounds, else the default. The preference itself is never rewritten
 * by a clamp, so a cap squeezed by a short window springs back when it grows.
 */
export const pinnedBodyCap = (
  preferred: number | null,
  bounds: PinnedBodyBounds
) =>
  preferred === null ? bounds.default : clamp(preferred, bounds.min, bounds.max);

/**
 * The body's height: its rows, up to the cap, so the block never shows empty
 * space beneath its last row.
 */
export const pinnedBodyHeight = (
  rowCount: number,
  rowHeight: number,
  cap: number
) => Math.min(rowCount * rowHeight, cap);

/**
 * The preference a resize leaves behind. `desired` is the body height the
 * gesture asks for, measured from the height on screen and snapped to whole
 * rows so the block never ends on a sliver of one.
 *
 * A block already showing every row has nothing more to reveal, so sizing it
 * at or past its last row is not a request for a smaller cap, and the
 * preference stands unless the gesture went past the cap in force. Without
 * this, nudging the divider under a collapsed pin would quietly shrink the
 * cap the pin reopens to.
 */
export const resizedBodyCap = (resize: {
  desired: number;
  rowHeight: number;
  /** Height of every row in the block, shown or not. */
  contentHeight: number;
  /** The cap in force before the gesture moved. */
  cap: number;
  preferred: number | null;
  bounds: PinnedBodyBounds;
}): number | null => {
  const { desired, rowHeight, contentHeight, cap, preferred, bounds } = resize;
  const snapped = clamp(
    Math.round(desired / rowHeight) * rowHeight,
    bounds.min,
    bounds.max
  );
  if (snapped >= contentHeight && snapped <= cap) return preferred;
  return snapped;
};
