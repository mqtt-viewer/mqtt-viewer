export const pointInRect = (
  x: number,
  y: number,
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom">
) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
